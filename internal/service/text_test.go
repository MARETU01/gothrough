package service

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

func TestSaveTextPreservesFormatAndRefreshesListing(t *testing.T) {
	for _, tc := range []struct{ name, before, after, expected string }{
		{"CRLF", "\ufeffone\r\ntwo\r\n", "one\nchanged\n", "\ufeffone\r\nchanged\r\n"},
		{"LF", "one\ntwo\n", "one\nchanged\n", "one\nchanged\n"},
		{"CR", "one\rtwo\r", "one\nchanged\n", "one\rchanged\r"},
		{"mixed unchanged", "one\r\ntwo\nthree\r", "one\ntwo\nthree\n", "one\r\ntwo\nthree\r"},
		{"empty", "old", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := testService(t)
			path := filepath.Join(s.uploadDir, "file.txt")
			if err := os.WriteFile(path, []byte(tc.before), 0640); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err := s.cachedFiles(); err != nil {
				t.Fatal(err)
			}
			version, err := s.SaveText("file.txt", TextVersion([]byte(tc.before)), tc.after)
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != tc.expected || version != TextVersion(data) {
				t.Fatalf("saved %q; expected %q", data, tc.expected)
			}
			after, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if after.Mode().Perm() != before.Mode().Perm() {
				t.Fatal("file mode changed")
			}
			files, size, err := s.cachedFiles()
			if err != nil || len(files) != 1 || size != int64(len(data)) {
				t.Fatalf("listing: %v %d %v", files, size, err)
			}
			entries, _ := os.ReadDir(s.uploadDir)
			if len(entries) != 1 {
				t.Fatal("temporary files leaked")
			}
		})
	}
}

func TestConcurrentTextSavesRejectStaleVersion(t *testing.T) {
	s := testService(t)
	path := filepath.Join(s.uploadDir, "file.txt")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	version := TextVersion([]byte("original"))
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, text := range []string{"first", "second"} {
		workers.Go(func() { _, err := s.SaveText("file.txt", version, text); results <- err })
	}
	workers.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrTextConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", success, conflicts)
	}
}

func TestTextEditValidationLeavesOriginalUntouched(t *testing.T) {
	s := testService(t)
	path := filepath.Join(s.uploadDir, "file.txt")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	version := TextVersion([]byte("original"))
	for _, tc := range []struct {
		name, version, text string
		expected            error
	}{
		{"file.txt", "stale", "updated", ErrTextConflict},
		{"file.txt", version, "nul\x00", ErrTextEncoding},
		{"file.txt", version, strings.Repeat("a", MaxTextBytes+1), ErrTextSize},
		{"../file.txt", version, "updated", ErrPath},
		{"file.bin", version, "updated", ErrTextType},
		{"missing.txt", version, "updated", os.ErrNotExist},
	} {
		if _, err := s.SaveText(tc.name, tc.version, tc.text); !errors.Is(err, tc.expected) {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0400); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SaveText("file.txt", version, "updated"); !errors.Is(err, os.ErrPermission) {
			t.Fatal(err)
		}
	}
	data, _ := os.ReadFile(path)
	if string(data) != "original" {
		t.Fatalf("file changed: %q", data)
	}
}
