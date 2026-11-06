package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotationRetentionAndAppend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	w, err := newRotatingWriter(path, 100, 2)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		line := fmt.Sprintf("{\"index\":%d,\"padding\":\"%s\"}\n", i, strings.Repeat("x", 60))
		if _, err := w.Write([]byte(line)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	for i, suffix := range []string{"", ".1", ".2"} {
		data, err := os.ReadFile(path + suffix)
		if err != nil {
			t.Fatal(err)
		}
		got := records(t, data)
		if len(got) != 1 || got[0]["index"] != float64(7-i) {
			t.Fatalf("archive %s: %v", suffix, got)
		}
	}
	if _, err := os.Stat(path + ".3"); !os.IsNotExist(err) {
		t.Fatal("retained too many backups")
	}
	w, err = newRotatingWriter(path, 1000, 2)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("{\"index\":8}\n")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || len(records(t, data)) != 2 {
		t.Fatal("restart truncated active log")
	}
}

func TestOversizedRecordIsNotSplit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	w, err := newRotatingWriter(path, 10, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("{\"message\":\"larger than limit\"}\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("{}\n")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path + ".1")
	if err != nil || len(records(t, data)) != 1 {
		t.Fatal("large record split or lost")
	}
}
