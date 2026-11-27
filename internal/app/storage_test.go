package app

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestStorageInitAndCleanup(t *testing.T) {
	dir := t.TempDir()
	temp := filepath.Join(dir, "temp_uploads")
	if err := os.MkdirAll(filepath.Join(temp, "old-session"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(temp, "old-session", "payload"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(temp, "keep.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	paths, err := PrepareStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = paths.Close() })
	if paths.BaseDir != dir || paths.TempDir != temp || paths.ClipboardDir != filepath.Join(dir, "clipboard") {
		t.Fatal("incorrect data root")
	}
	if _, err := os.Stat(filepath.Join(temp, "old-session")); !os.IsNotExist(err) {
		t.Fatal("old session not cleaned")
	}
	if _, err := os.Stat(filepath.Join(temp, "keep.txt")); err != nil {
		t.Fatal("unrelated file removed")
	}
}

func TestStorageInitFailureDoesNotClean(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "temp_uploads", "old-session")
	if err := os.MkdirAll(old, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "uploads"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareStorage(dir); err == nil {
		t.Fatal("expected directory error")
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("failed validation cleaned sessions")
	}
	if err := os.Remove(filepath.Join(dir, "uploads")); err != nil {
		t.Fatal(err)
	}
	paths, err := PrepareStorage(dir)
	if err != nil {
		t.Fatalf("initialization failure left storage locked: %v", err)
	}
	t.Cleanup(func() { _ = paths.Close() })
	if _, err := PrepareStorage(""); err == nil {
		t.Fatal("accepted empty data root")
	}
	if err := cleanupTempUploads(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("cleanup read error ignored")
	}
}

func TestStorageLockProtectsActiveInstance(t *testing.T) {
	dir := t.TempDir()
	first, err := PrepareStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Close() })
	session := filepath.Join(first.TempDir, "active-session")
	if err := os.Mkdir(session, 0700); err != nil {
		t.Fatal(err)
	}
	if second, err := PrepareStorage(dir); !errors.Is(err, ErrStorageInUse) {
		if err == nil {
			_ = second.Close()
		}
		t.Fatalf("expected storage in use, got %v", err)
	}
	if _, err := os.Stat(session); err != nil {
		t.Fatalf("competing startup touched the active session: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := PrepareStorage(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = next.Close() })
	if _, err := os.Stat(session); !os.IsNotExist(err) {
		t.Fatalf("new owner did not clean the abandoned session: %v", err)
	}
}
