package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

type failingArchiveWriter struct{}

func (failingArchiveWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

type archiveWriterFunc func([]byte) (int, error)

func (f archiveWriterFunc) Write(p []byte) (int, error) { return f(p) }

func TestFolderArchiveInterruptedDuringTransfer(t *testing.T) {
	for _, mode := range []string{"cancel", "delete"} {
		t.Run(mode, func(t *testing.T) {
			base := t.TempDir()
			dir := filepath.Join(base, "folder")
			if err := os.Mkdir(dir, 0755); err != nil {
				t.Fatal(err)
			}
			data := make([]byte, 128*1024)
			if _, err := rand.Read(data); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"a.bin", "b.bin"} {
				if err := os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			s := NewUploadService(base, t.TempDir())
			defer s.Close()
			a, err := s.OpenFolder("folder")
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var buffer bytes.Buffer
			interrupted := false
			err = a.WriteZIP(ctx, archiveWriterFunc(func(p []byte) (int, error) {
				if !interrupted {
					interrupted = true
					if mode == "cancel" {
						cancel()
					} else if err := os.Remove(filepath.Join(dir, "b.bin")); err != nil {
						t.Fatal(err)
					}
				}
				return buffer.Write(p)
			}))
			if !interrupted || err == nil {
				t.Fatalf("interruption: %v %v", interrupted, err)
			}
			if mode == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if _, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len())); err == nil {
				t.Fatal("partial archive looks complete")
			}
		})
	}
}

func TestFolderArchiveCancellationAndWriterFailure(t *testing.T) {
	base := t.TempDir()
	if err := os.Mkdir(filepath.Join(base, "folder"), 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(base, "folder", "file.txt")
	if err := os.WriteFile(file, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	s := NewUploadService(base, t.TempDir())
	defer s.Close()
	a, err := s.OpenFolder("folder")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var buffer bytes.Buffer
	if err := a.WriteZIP(ctx, &buffer); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	if _, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len())); err == nil {
		t.Fatal("cancelled ZIP looks complete")
	}
	if err := a.WriteZIP(context.Background(), failingArchiveWriter{}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("write failure: %v", err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	// Especially on Windows, leaked file handles prevent removal.
	if err := os.RemoveAll(filepath.Join(base, "folder")); err != nil {
		t.Fatal(err)
	}
}
