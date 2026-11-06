package utils

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestStorageProbeAndCleanup(t *testing.T) {
	dir := t.TempDir()
	temp, target := filepath.Join(dir, "temp"), filepath.Join(dir, "target")
	for _, path := range []string{temp, target} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := CheckStorage(temp, target); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{temp, target} {
		entries, err := os.ReadDir(path)
		if err != nil || len(entries) != 0 {
			t.Fatalf("probe files leaked: %v %v", entries, err)
		}
	}
	if err := CheckStorage(temp, filepath.Join(dir, "missing")); err == nil {
		t.Fatal("accepted missing target")
	}
	entries, err := os.ReadDir(temp)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed probe leaked source")
	}
}

func TestStorageErrorPreservesCause(t *testing.T) {
	cause := &os.PathError{Op: "open", Path: "private", Err: os.ErrPermission}
	err := StorageError("写入失败", cause)
	if !errors.Is(err, ErrStoragePermission) || !errors.Is(err, os.ErrPermission) {
		t.Fatalf("cause lost: %v", err)
	}
	var pathError *os.PathError
	if !errors.As(err, &pathError) {
		t.Fatal("path error lost")
	}
	if StorageError("ok", nil) != nil {
		t.Fatal("nil became an error")
	}
}
