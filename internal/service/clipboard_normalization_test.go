package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestStoredTextGetsExplicitTypeWithoutRewritingOrLosingHistory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	original := []byte(`[{"id":"kept-id","text":"keep this text","created_at":"2026-11-05T12:00:00Z"}]`)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	entries := s.List()
	if len(entries) != 1 || entries[0].Type != "text" || entries[0].ID != "kept-id" || entries[0].Text != "keep this text" || entries[0].CreatedAt != "2026-11-05T12:00:00Z" {
		t.Fatalf("history changed: %+v", entries)
	}
	body, _ := s.Snapshot()
	var response struct {
		Entries []model.ClipboardEntry `json:"entries"`
	}
	if err := json.Unmarshal([]byte(body), &response); err != nil || len(response.Entries) != 1 || response.Entries[0].Type != "text" {
		t.Fatalf("response omitted type: %s %v", body, err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != string(original) {
		t.Fatalf("startup rewrote source: %s %v", data, err)
	}
	created, err := s.Create("new text")
	if err != nil || created.Type != "text" {
		t.Fatalf("new entry: %+v %v", created, err)
	}
	reopened, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := reopened.List(); len(got) != 2 || got[1] != entries[0] {
		t.Fatalf("saving erased history: %+v", got)
	}
}
