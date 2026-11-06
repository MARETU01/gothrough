package service

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
	"uuid"

	"github.com/MARETU01/gothrough/internal/model"
)

const (
	ClipboardMaxBytes   = 64 * 1024
	ClipboardMaxEntries = 100
)

var (
	ErrClipboardText     = errors.New("文本不能为空，且不能超过 64 KiB")
	ErrClipboardNotFound = errors.New("剪贴板记录不存在")
)

// ClipboardService owns a bounded, newest-first history. Mutations are committed
// to a temporary file and atomically renamed before becoming visible in memory.
type ClipboardService struct {
	mu      sync.RWMutex
	path    string
	entries []model.ClipboardEntry
	body    string
	etag    string
}

func NewClipboardService(dir string) (*ClipboardService, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &ClipboardService{path: filepath.Join(dir, "history.json"), entries: []model.ClipboardEntry{}}
	f, err := os.Open(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.updateSnapshot()
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// JSON may encode one byte as six characters (e.g. an escaped control).
	data, err := io.ReadAll(io.LimitReader(f, ClipboardMaxBytes*6*ClipboardMaxEntries+65537))
	if err != nil {
		return nil, err
	}
	if len(data) > ClipboardMaxBytes*6*ClipboardMaxEntries+65536 {
		return nil, fmt.Errorf("剪贴板历史文件过大")
	}
	if err := json.Unmarshal(data, &s.entries); err != nil {
		return nil, fmt.Errorf("读取剪贴板历史: %w", err)
	}
	if len(s.entries) > ClipboardMaxEntries {
		return nil, fmt.Errorf("剪贴板历史记录过多")
	}
	seen := make(map[string]bool)
	for _, entry := range s.entries {
		_, dateErr := time.Parse(time.RFC3339Nano, entry.CreatedAt)
		if entry.ID == "" || seen[entry.ID] || !validClipboardText(entry.Text) || dateErr != nil {
			return nil, fmt.Errorf("剪贴板历史记录无效")
		}
		seen[entry.ID] = true
	}
	if s.entries == nil {
		s.entries = []model.ClipboardEntry{}
	}
	s.updateSnapshot()
	return s, nil
}

// Snapshot returns an immutable JSON representation and its matching validator.
// Both are replaced together, only after a mutation has been persisted.
func (s *ClipboardService) Snapshot() (body, etag string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.body, s.etag
}

func (s *ClipboardService) updateSnapshot() {
	// ClipboardEntry contains only strings, so marshaling cannot fail.
	data, _ := json.Marshal(struct {
		Entries []model.ClipboardEntry `json:"entries"`
	}{s.entries})
	s.body = string(data)
	s.etag = fmt.Sprintf(`"%x"`, sha256.Sum256(data))
}

func validClipboardText(text string) bool {
	return utf8.ValidString(text) && strings.TrimSpace(text) != "" && len(text) <= ClipboardMaxBytes
}

func (s *ClipboardService) List() []model.ClipboardEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]model.ClipboardEntry{}, s.entries...)
}

func (s *ClipboardService) Create(text string) (model.ClipboardEntry, error) {
	if !validClipboardText(text) {
		return model.ClipboardEntry{}, ErrClipboardText
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := model.ClipboardEntry{ID: uuid.NewV7().String(), Text: text, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	next := make([]model.ClipboardEntry, 1, ClipboardMaxEntries)
	next[0] = entry
	next = append(next, s.entries[:min(len(s.entries), ClipboardMaxEntries-1)]...)
	if err := s.save(next); err != nil {
		return model.ClipboardEntry{}, err
	}
	s.entries = next
	s.updateSnapshot()
	return entry, nil
}

func (s *ClipboardService) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, entry := range s.entries {
		if entry.ID != id {
			continue
		}
		next := append([]model.ClipboardEntry{}, s.entries[:i]...)
		next = append(next, s.entries[i+1:]...)
		if err := s.save(next); err != nil {
			return err
		}
		s.entries = next
		s.updateSnapshot()
		return nil
	}
	return ErrClipboardNotFound
}

func (s *ClipboardService) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := []model.ClipboardEntry{}
	if err := s.save(next); err != nil {
		return err
	}
	s.entries = next
	s.updateSnapshot()
	return nil
}

func (s *ClipboardService) save(entries []model.ClipboardEntry) error {
	f, err := os.CreateTemp(filepath.Dir(s.path), ".history-*.tmp")
	if err != nil {
		return err
	}
	defer func() {
		if err := os.Remove(f.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("清理剪贴板临时文件失败", "event", "clipboard.cleanup_failed", "error", err)
		}
	}()
	defer f.Close()
	if err := json.NewEncoder(f).Encode(entries); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), s.path)
}
