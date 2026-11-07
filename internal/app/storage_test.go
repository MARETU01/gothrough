package app

import (
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
	// A file at the clipboard directory prevents a complete initialization.
	if err := os.WriteFile(filepath.Join(dir, "clipboard"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareStorage(dir); err == nil {
		t.Fatal("expected directory error")
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("failed validation cleaned sessions")
	}
	if _, err := PrepareStorage(""); err == nil {
		t.Fatal("accepted empty data root")
	}
	if err := cleanupTempUploads(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("cleanup read error ignored")
	}
}
