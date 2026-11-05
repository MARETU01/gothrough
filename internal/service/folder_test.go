package service

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestFolderUploadPreservesPathsAndConflicts(t *testing.T) {
	s := testService(t)
	for _, path := range []string{"项目/a/same.txt", "项目/b/same.txt", "项目/a/same.txt", "项目/100%20.txt"} {
		info, err := s.InitSession(model.InitRequest{Filename: filepath.Base(path), RelativePath: path, TotalSize: 5})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("hello")); err != nil {
			t.Fatal(err)
		}
		name, _, err := s.CompleteSession(info.SessionID)
		if err != nil {
			t.Fatal(err)
		}
		if filepath.ToSlash(filepath.Dir(name)) != filepath.ToSlash(filepath.Dir(path)) {
			t.Fatalf("directory changed: %s -> %s", path, name)
		}
	}
	files, size, err := s.ListFiles()
	if err != nil || len(files) != 4 || size != 20 {
		t.Fatalf("list: %v %d %v", files, size, err)
	}
	for _, file := range files {
		if data, err := os.ReadFile(filepath.Join(s.uploadDir, file.Name)); err != nil || string(data) != "hello" {
			t.Fatalf("saved file: %q %v", data, err)
		}
		if err := s.DeleteFile(file.Name); err != nil {
			t.Fatal(err)
		}
	}
	files, size, err = s.ListFiles()
	if err != nil || len(files) != 0 || size != 0 {
		t.Fatalf("list after deletion: %v %d %v", files, size, err)
	}
}

func TestFolderUploadRejectsUnsafePaths(t *testing.T) {
	s := testService(t)
	for _, path := range []string{"../a", "a/../../b", "/absolute/a", `C:\dir\a`, `\\server\a`, "a//b", "a/./b", "a/../b", "a/", strings.Repeat("a/", 33) + "b"} {
		if _, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: path}); !errors.Is(err, ErrPath) {
			t.Errorf("%q: expected invalid path, got %v", path, err)
		}
	}
}

func TestFolderUploadRejectsSymlinkParent(t *testing.T) {
	s := testService(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(s.uploadDir, "escape")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	info, err := s.InitSession(model.InitRequest{Filename: "file.txt", RelativePath: "escape/file.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(info.SessionID); err == nil {
		t.Fatal("published outside upload directory")
	}
	if _, err := os.Stat(filepath.Join(outside, "file.txt")); !os.IsNotExist(err) {
		t.Fatalf("outside file: %v", err)
	}
}
