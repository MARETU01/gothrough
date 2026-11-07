package service

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

func TestCancelledAndExpiredUploadsRemoveEmptyParents(t *testing.T) {
	s := testService(t)
	a, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: "shared/one/a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.InitSession(model.InitRequest{Filename: "b", RelativePath: "shared/two/b"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelSession(a.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "shared/one")); !os.IsNotExist(err) {
		t.Fatalf("cancel leaked parents: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "shared/two")); err != nil {
		t.Fatalf("active upload parent removed: %v", err)
	}
	entry, _ := s.lookup(b.SessionID)
	entry.mu.Lock()
	entry.touched = time.Now().Add(-time.Hour)
	entry.mu.Unlock()
	s.ExpireIdle(time.Minute)
	entries, err := os.ReadDir(s.uploadDir)
	if err != nil || len(entries) != 0 || len(s.createdDirs) != 0 {
		t.Fatalf("expiration leaked parents: %v %v", entries, err)
	}
}

func TestFailedInitRollsBackOnlyOwnedParents(t *testing.T) {
	s := testService(t)
	existing := filepath.Join(s.uploadDir, "existing")
	if err := os.Mkdir(existing, 0755); err != nil {
		t.Fatal(err)
	}
	s.diskUsage = func(string) (utils.DiskUsage, error) { return utils.DiskUsage{Free: 0}, nil }
	_, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: "existing/new/deep/a", TotalSize: 1})
	if !errors.Is(err, utils.ErrStorageFull) {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(existing)
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed init leaked directories or removed existing parent: %v %v", entries, err)
	}
	if len(s.createdDirs) != 0 || len(s.sessions) != 0 || len(s.names) != 0 {
		t.Fatal("failed init retained reservations")
	}
}

func TestDeleteLastFileRemovesOwnedParents(t *testing.T) {
	s := testService(t)
	info, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: "folder/sub/a"})
	if err != nil {
		t.Fatal(err)
	}
	name, _, err := s.CompleteSession(info.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteFile(name); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(s.uploadDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("deletion leaked empty parents: %v %v", entries, err)
	}
}

func TestInitRejectsOversizedOriginalFilename(t *testing.T) {
	s := testService(t)
	_, err := s.InitSession(model.InitRequest{Filename: strings.Repeat("a", 4097)})
	if !errors.Is(err, ErrPath) || len(s.sessions) != 0 {
		t.Fatalf("oversized filename retained: %v", err)
	}
}

func TestCancelPreservesReplacementDirectory(t *testing.T) {
	s := testService(t)
	info, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: "folder/a"})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.uploadDir, "folder")
	if err := os.Rename(path, path+"-original"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0755); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelSession(info.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("removed externally replaced directory: %v", err)
	}
}

func TestCancelCleansWindowsCaseAliases(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows case-insensitive directory aliases")
	}
	s := testService(t)
	a, err := s.InitSession(model.InitRequest{Filename: "a", RelativePath: "Folder/a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.InitSession(model.InitRequest{Filename: "b", RelativePath: "folder/b"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelSession(a.SessionID); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelSession(b.SessionID); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(s.uploadDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("case alias leaked parent: %v %v", entries, err)
	}
}
