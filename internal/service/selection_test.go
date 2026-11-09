package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

func selectionFiles(t *testing.T, s *FileService) {
	t.Helper()
	for name, content := range map[string]string{"one/same.txt": "one", "two/same.txt": "two", "root.txt": "root"} {
		full := filepath.Join(s.uploadDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSelectionArchivePreservesPathsAndCollapsesOverlap(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	a, err := s.OpenSelection([]string{"one/same.txt", "two/same.txt", "one", "root.txt"})
	if err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	if err := a.WriteZIP(context.Background(), &body); err != nil {
		t.Fatal(err)
	}
	a.Close()
	archive, err := zip.NewReader(bytes.NewReader(body.Bytes()), int64(body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	got := make(map[string]string)
	for _, file := range archive.File {
		if _, duplicate := got[file.Name]; duplicate {
			t.Fatalf("duplicate ZIP entry: %s", file.Name)
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		got[file.Name] = string(content)
	}
	if len(got) != 4 || got["one/same.txt"] != "one" || got["two/same.txt"] != "two" || got["root.txt"] != "root" {
		t.Fatalf("archive: %#v", got)
	}
}

func TestSelectionValidationPrecedesAnyDeletion(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	for _, invalid := range []string{"", ".", "..", "../outside", "/root.txt", "one/../root.txt", "one//same.txt", `one\same.txt`, "C:/outside", "one\x00"} {
		entries := []SelectionEntry{{Path: "root.txt"}, {Path: invalid}}
		if _, err := s.DeleteSelection(context.Background(), entries); !errors.Is(err, ErrSelection) {
			t.Fatalf("%q: %v", invalid, err)
		}
		if _, err := os.Stat(filepath.Join(s.uploadDir, "root.txt")); err != nil {
			t.Fatalf("invalid selection deleted a valid item: %v", err)
		}
	}
	if _, err := s.OpenSelection([]string{"root.txt", "root.txt"}); !errors.Is(err, ErrSelection) {
		t.Fatal("duplicate accepted")
	}
	if _, err := s.OpenSelection(make([]string, MaxSelectionEntries+1)); !errors.Is(err, ErrSelection) {
		t.Fatal("unbounded selection accepted")
	}
}

func TestSelectionDeletionReportsPartialResultsAndChecksTypes(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	if _, err := s.StorageInfo(); err != nil {
		t.Fatal(err)
	}
	results, err := s.DeleteSelection(context.Background(), []SelectionEntry{{Path: "root.txt"}, {Path: "one", Folder: true}, {Path: "missing.txt"}, {Path: "two/same.txt", Folder: true}})
	if err != nil {
		t.Fatal(err)
	}
	if results[0].Err != nil || results[1].Err != nil || !errors.Is(results[2].Err, os.ErrNotExist) || !errors.Is(results[3].Err, ErrSelectionChanged) {
		t.Fatalf("results: %+v", results)
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "one")); !os.IsNotExist(err) {
		t.Fatalf("folder not removed: %v", err)
	}
	listing, err := s.StorageInfo()
	if err != nil || len(listing.Files) != 1 || listing.Files[0].Name != "two/same.txt" {
		t.Fatalf("cache not invalidated: %+v %v", listing, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	results, err = s.DeleteSelection(ctx, []SelectionEntry{{Path: "two", Folder: true}})
	if err != nil || !errors.Is(results[0].Err, context.Canceled) {
		t.Fatalf("cancellation: %+v %v", results, err)
	}
}

type selectionReaderFunc func([]byte) (int, error)

func (f selectionReaderFunc) Read(p []byte) (int, error) { return f(p) }

func TestSelectionDeletionRejectsFoldersWithActiveTransfersWithoutWaiting(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	session, err := s.InitSession(model.InitRequest{Filename: "pending.txt", RelativePath: "one/pending.txt", TotalSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	reading, release, written := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	defer close(release)
	reader := bytes.NewBufferString("x")
	first := true
	go func() {
		_, err := s.WriteChunk(session.SessionID, 0, selectionReaderFunc(func(p []byte) (int, error) {
			if first {
				first = false
				close(reading)
				<-release
			}
			return reader.Read(p)
		}))
		written <- err
	}()
	<-reading
	done := make(chan error, 1)
	go func() {
		results, err := s.DeleteSelection(context.Background(), []SelectionEntry{{Path: "one", Folder: true}})
		if err == nil {
			err = results[0].Err
		}
		done <- err
	}()
	select {
	case err := <-done:
		if !errors.Is(err, ErrFolderBusy) {
			t.Fatalf("busy folder: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("deletion waited for an active stream")
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "one/same.txt")); err != nil {
		t.Fatal("busy folder was modified")
	}
	// release runs before testService's cleanup, which waits for the active writer.
	t.Cleanup(func() {
		if err := <-written; err != nil {
			t.Error(err)
		}
	})
}

func TestSelectionDoesNotFollowSymlinks(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	if err := os.Symlink(filepath.Join(s.uploadDir, "two"), filepath.Join(s.uploadDir, "one", "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := s.OpenSelection([]string{"one/link/same.txt"}); err == nil {
		t.Fatal("followed symlink")
	}
	results, err := s.DeleteSelection(context.Background(), []SelectionEntry{{Path: "one", Folder: true}})
	if err != nil || results[0].Err == nil {
		t.Fatalf("symlink tree: %+v %v", results, err)
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "one/same.txt")); err != nil {
		t.Fatal("preflight modified the folder")
	}
	if content, err := os.ReadFile(filepath.Join(s.uploadDir, "two/same.txt")); err != nil || string(content) != "two" {
		t.Fatal("symlink target changed")
	}
}

func TestSelectionArchiveCancellationDoesNotFinalizePartialZIP(t *testing.T) {
	s := testService(t)
	selectionFiles(t, s)
	a, err := s.OpenSelection([]string{"root.txt", "one"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var body bytes.Buffer
	if err := a.WriteZIP(ctx, &body); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := zip.NewReader(bytes.NewReader(body.Bytes()), int64(body.Len())); err == nil {
		t.Fatal("cancelled ZIP looks complete")
	}
}
