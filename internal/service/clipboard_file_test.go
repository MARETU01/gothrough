package service

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestClipboardWriteFailurePreservesPreviousFile(t *testing.T) {
	for _, failure := range []string{"encode", "rename"} {
		t.Run(failure, func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "history.json")
			original := []byte("previous history")
			if failure == "rename" {
				if err := os.Mkdir(target, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(target, "keep"), original, 0600); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(target, original, 0600); err != nil {
				t.Fatal(err)
			}
			cause := errors.New("encode failed")
			err := writeClipboardFile(target, ".history-*.tmp", func(writer io.Writer) error {
				if _, err := writer.Write([]byte("partial new history")); err != nil {
					return err
				}
				if failure == "encode" {
					return cause
				}
				return nil
			})
			if err == nil || (failure == "encode" && !errors.Is(err, cause)) {
				t.Fatalf("failure lost: %v", err)
			}
			entries, err := os.ReadDir(dir)
			if err != nil || len(entries) != 1 {
				t.Fatalf("temporary file leaked: %v %v", entries, err)
			}
			preserved := target
			if failure == "rename" {
				preserved = filepath.Join(target, "keep")
			}
			data, err := os.ReadFile(preserved)
			if err != nil || string(data) != string(original) {
				t.Fatalf("previous contents changed: %q %v", data, err)
			}
		})
	}
}
