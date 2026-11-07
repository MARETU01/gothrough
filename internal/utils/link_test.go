package utils

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func directoryLink(t *testing.T, target, name string) {
	t.Helper()
	if err := os.Symlink(target, name); err == nil {
		return
	} else if runtime.GOOS != "windows" {
		t.Skipf("symlink unavailable: %v", err)
	}
	if output, err := exec.Command("cmd", "/c", "mklink", "/J", name, target).CombinedOutput(); err != nil {
		t.Skipf("junction unavailable: %v %s", err, output)
	}
}

func TestLinkIntoPinsDestinationAcrossReplacement(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	destination := filepath.Join(dir, "destination")
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	parent, err := root.Open("destination")
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	source := filepath.Join(dir, "payload")
	if err := os.WriteFile(source, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(destination, destination+"-original"); err != nil {
		t.Fatal(err)
	}
	directoryLink(t, outside, destination)
	defer os.Remove(destination)
	if err := LinkInto(source, parent, "published.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(outside, "published.txt")); !os.IsNotExist(err) {
		t.Fatalf("escaped upload directory: %v", err)
	}
	path := filepath.Join(destination+"-original", "published.txt")
	if data, err := os.ReadFile(path); err != nil || string(data) != "content" {
		t.Fatalf("publication: %q %v", data, err)
	}
	if err := LinkInto(source, parent, "published.txt"); !errors.Is(err, os.ErrExist) {
		t.Fatalf("existing file overwritten: %v", err)
	}
	for _, name := range []string{"", ".", "../escape"} {
		if err := LinkInto(source, parent, name); !errors.Is(err, os.ErrInvalid) {
			t.Fatalf("invalid name %q: %v", name, err)
		}
	}
}

func TestStorageProbeRejectsEscapingParent(t *testing.T) {
	dir, outside, temp := t.TempDir(), t.TempDir(), t.TempDir()
	link := filepath.Join(dir, "escape")
	directoryLink(t, outside, link)
	defer os.Remove(link)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := CheckStorageInRoot(temp, root, "escape"); err == nil {
		t.Fatal("accepted escaping parent")
	}
	for _, directory := range []string{temp, outside} {
		entries, err := os.ReadDir(directory)
		if err != nil || len(entries) != 0 {
			t.Fatalf("probe left files in %s: %v %v", directory, entries, err)
		}
	}
}
