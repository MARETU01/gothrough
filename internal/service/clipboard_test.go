package service

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestClipboardPersistenceAndRetention(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.List() == nil || len(s.List()) != 0 {
		t.Fatal("expected empty array")
	}
	first, err := s.Create("  中文\n<script>alert(1)</script>\t ")
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewClipboardService(dir)
	if err != nil || len(reopened.List()) != 1 || reopened.List()[0] != first {
		t.Fatalf("restart: %v %v", reopened, err)
	}
	copy := s.List()
	copy[0].Text = "mutated"
	if s.List()[0].Text != first.Text {
		t.Fatal("list exposed mutable state")
	}
	for i := 0; i < ClipboardMaxEntries; i++ {
		if _, err := s.Create(fmt.Sprintf("text %d", i)); err != nil {
			t.Fatal(err)
		}
	}
	entries := s.List()
	if len(entries) != ClipboardMaxEntries || entries[0].Text != "text 99" || entries[99].Text != "text 0" {
		t.Fatal("retention or order incorrect")
	}
	if err := s.Delete(first.ID); !errors.Is(err, ErrClipboardNotFound) {
		t.Fatal("oldest not evicted")
	}
	if err := s.Delete(entries[0].ID); err != nil {
		t.Fatal(err)
	}
	reopened, err = NewClipboardService(dir)
	if err != nil || len(reopened.List()) != 99 || reopened.List()[0].Text != "text 98" {
		t.Fatalf("delete not persisted: %v", err)
	}
}

func TestClipboardClearPersists(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"first", "second"} {
		if _, err := s.Create(text); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if entries := s.List(); entries == nil || len(entries) != 0 {
		t.Fatal("clear did not empty memory")
	}
	reopened, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if entries := reopened.List(); entries == nil || len(entries) != 0 {
		t.Fatal("clear did not persist")
	}
	if err := reopened.Clear(); err != nil {
		t.Fatalf("clearing empty history: %v", err)
	}
	if _, err := reopened.Create("new record"); err != nil {
		t.Fatal(err)
	}
	if len(reopened.List()) != 1 {
		t.Fatal("cannot publish after clearing")
	}
}

func TestClipboardTextLimits(t *testing.T) {
	s, err := NewClipboardService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"", " \n\t\u3000", strings.Repeat("a", ClipboardMaxBytes+1), strings.Repeat("中", ClipboardMaxBytes/3+1), string([]byte{0xff})} {
		if _, err := s.Create(text); !errors.Is(err, ErrClipboardText) {
			t.Fatalf("invalid text accepted: %v", err)
		}
	}
	for _, text := range []string{strings.Repeat("a", ClipboardMaxBytes), strings.Repeat("中", ClipboardMaxBytes/3) + "a"} {
		if _, err := s.Create(text); err != nil {
			t.Fatalf("boundary rejected: %v", err)
		}
	}
}

func TestClipboardFailedSavePreservesHistory(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.Create("keep me")
	if err != nil {
		t.Fatal(err)
	}
	body, etag := s.Snapshot()
	// A directory at the destination makes atomic replacement fail on all hosts.
	s.path = filepath.Join(dir, "blocked")
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.path, "child"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("not saved"); err == nil {
		t.Fatal("expected write failure")
	}
	if err := s.Delete(entry.ID); err == nil {
		t.Fatal("expected delete failure")
	}
	if err := s.Clear(); err == nil {
		t.Fatal("expected clear failure")
	}
	if entries := s.List(); len(entries) != 1 || entries[0] != entry {
		t.Fatal("failed mutation changed memory")
	}
	if gotBody, gotTag := s.Snapshot(); gotBody != body || gotTag != etag {
		t.Fatal("failed mutation changed snapshot")
	}
	reopened, err := NewClipboardService(dir)
	if err != nil || len(reopened.List()) != 1 || reopened.List()[0] != entry {
		t.Fatal("failed mutation changed disk")
	}
	leftovers, err := filepath.Glob(filepath.Join(dir, ".history-*.tmp"))
	if err != nil || len(leftovers) != 0 {
		t.Fatal("temporary files leaked")
	}
}

func TestClipboardConcurrentMutations(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			entry, err := s.Create(fmt.Sprintf("concurrent %d", i))
			if err != nil {
				t.Error(err)
				return
			}
			_ = s.List()
			body, etag := s.Snapshot()
			if etag != fmt.Sprintf(`"%x"`, sha256.Sum256([]byte(body))) {
				t.Error("snapshot and validator disagree")
			}
			if i%2 == 0 {
				if err := s.Delete(entry.ID); err != nil {
					t.Error(err)
				}
			}
		}(i)
	}
	wg.Wait()
	reopened, err := NewClipboardService(dir)
	if err != nil || len(reopened.List()) != 12 {
		t.Fatalf("concurrent data lost: %v", err)
	}
}

func TestClipboardSnapshotAcrossMutationsAndRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	emptyBody, emptyTag := s.Snapshot()
	if emptyBody != `{"entries":[]}` || emptyTag == "" {
		t.Fatalf("empty snapshot: %s %s", emptyBody, emptyTag)
	}
	first, err := s.Create("snapshot <text>\n中文")
	if err != nil {
		t.Fatal(err)
	}
	body, tag := s.Snapshot()
	var snapshot struct {
		Entries []model.ClipboardEntry `json:"entries"`
	}
	if err := json.Unmarshal([]byte(body), &snapshot); err != nil || len(snapshot.Entries) != 1 || snapshot.Entries[0] != first || tag == emptyTag {
		t.Fatalf("created snapshot: %s %s %v", body, tag, err)
	}
	reopened, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if gotBody, gotTag := reopened.Snapshot(); gotBody != body || gotTag != tag {
		t.Fatal("unchanged history got a different validator after restart")
	}
	second, err := s.Create("second")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(second.ID); err != nil {
		t.Fatal(err)
	}
	if gotBody, gotTag := s.Snapshot(); gotBody != body || gotTag != tag {
		t.Fatal("deleting newest record did not restore prior representation")
	}
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if gotBody, gotTag := s.Snapshot(); gotBody != emptyBody || gotTag != emptyTag {
		t.Fatal("clear did not restore empty representation")
	}
}

func TestClipboardCorruptHistoryIsNotOverwritten(t *testing.T) {
	for _, content := range []string{`{broken`, `[{"id":"x","text":"","created_at":"bad"}]`} {
		dir := t.TempDir()
		path := filepath.Join(dir, "history.json")
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := NewClipboardService(dir); err == nil {
			t.Fatal("accepted corrupt history")
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != content {
			t.Fatal("corrupt history overwritten")
		}
	}
	// A valid empty stored array must continue to serialize as [], not null.
	s, err := NewClipboardService(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.Create("last")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	var empty []model.ClipboardEntry = s.List()
	if empty == nil || len(empty) != 0 {
		t.Fatal("empty list is not an array")
	}
}
