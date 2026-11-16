package service

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"
	"uuid"
)

const spreadsheetSaveLifetime = time.Hour
const maxSpreadsheetSaves = 256

var ErrSpreadsheetOperation = errors.New("保存操作标识无效或已用于其他修改")

type spreadsheetSaveReceipt struct {
	started     time.Time
	path        string
	fingerprint string
	version     string // empty while the operation is pending
	expires     time.Time
}

type SpreadsheetSaveResult struct {
	Status  string              `json:"status"`
	Version string              `json:"version,omitempty"`
	Preview *SpreadsheetPreview `json:"preview,omitempty"`
}

// Receipts retain no workbook data. Publication and confirmation share mu.
func (s *FileService) SaveSpreadsheetOperation(ctx context.Context, filename, version string, changes []SpreadsheetChange, id string) (*SpreadsheetSaveResult, error) {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		return nil, ErrSpreadsheetOperation
	}
	rel := s.RelativePath(filename)
	if rel == "" {
		return nil, ErrFileInaccessible
	}
	rel = filepath.ToSlash(rel)
	payload, err := json.Marshal(struct {
		Path, Version string
		Changes       []SpreadsheetChange
	}{rel, version, changes})
	if err != nil {
		return nil, err
	}
	fingerprint := TextVersion(payload)
	s.mu.Lock()
	now := time.Now()
	if receipt, ok := s.spreadsheetSaves[id]; ok && (receipt.version == "" || now.Before(receipt.expires)) {
		s.mu.Unlock()
		if receipt.path != rel || receipt.fingerprint != fingerprint {
			return nil, ErrSpreadsheetOperation
		}
		if receipt.version == "" {
			return nil, ErrBusy
		}
		return &SpreadsheetSaveResult{Status: "saved", Version: receipt.version}, nil
	}
	delete(s.spreadsheetSaves, id)
	oldestID := ""
	var oldest time.Time
	for key, receipt := range s.spreadsheetSaves {
		if receipt.version == "" {
			continue
		}
		if !now.Before(receipt.expires) {
			delete(s.spreadsheetSaves, key)
			continue
		}
		if oldestID == "" || receipt.expires.Before(oldest) {
			oldestID, oldest = key, receipt.expires
		}
	}
	if len(s.spreadsheetSaves) >= maxSpreadsheetSaves {
		if oldestID == "" {
			s.mu.Unlock()
			return nil, ErrBusy
		}
		delete(s.spreadsheetSaves, oldestID)
	}
	s.spreadsheetSaves[id] = spreadsheetSaveReceipt{path: rel, fingerprint: fingerprint, started: now}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if receipt, ok := s.spreadsheetSaves[id]; ok && receipt.version == "" && receipt.started == now {
			delete(s.spreadsheetSaves, id)
		}
	}()
	preview, err := s.saveSpreadsheet(ctx, rel, version, changes, id)
	if err != nil {
		return nil, err
	}
	return &SpreadsheetSaveResult{Status: "saved", Version: preview.Version, Preview: preview}, nil
}

// Unknown includes expired/evicted receipts and restarts; it is not proof of failure.
func (s *FileService) SpreadsheetSaveStatus(filename, id string) SpreadsheetSaveResult {
	rel := filepath.ToSlash(s.RelativePath(filename))
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.spreadsheetSaves[id]
	if ok && receipt.version != "" && !time.Now().Before(receipt.expires) {
		delete(s.spreadsheetSaves, id)
		ok = false
	}
	if !ok || rel == "" || receipt.path != rel {
		return SpreadsheetSaveResult{Status: "unknown"}
	}
	if receipt.version == "" {
		return SpreadsheetSaveResult{Status: "pending"}
	}
	return SpreadsheetSaveResult{Status: "saved", Version: receipt.version}
}
