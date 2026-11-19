package service

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"time"
	"uuid"
)

const saveReceiptLifetime = time.Hour
const maxSaveReceipts = 256

var ErrSaveOperation = errors.New("保存操作标识无效或已用于其他修改")

type saveReceipt struct {
	kind        string
	started     time.Time
	path        string
	fingerprint string
	version     string // empty while the operation is pending
	expires     time.Time
}

type SaveOperationStatus struct {
	Status  string `json:"status"`
	Version string `json:"version,omitempty"`
}

// Text and spreadsheet saves share bounded receipts and the mutation lock.
// Operation kind, path, original version, and payload are all bound to the ID.
func (s *FileService) beginSaveOperation(kind, filename, version string, payload any, id string) (SaveOperationStatus, func(), error) {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		return SaveOperationStatus{}, nil, ErrSaveOperation
	}
	rel := s.RelativePath(filename)
	if rel == "" {
		return SaveOperationStatus{}, nil, ErrFileInaccessible
	}
	rel = filepath.ToSlash(rel)
	encoded, err := json.Marshal(struct {
		Kind, Path, Version string
		Payload             any
	}{kind, rel, version, payload})
	if err != nil {
		return SaveOperationStatus{}, nil, err
	}
	fingerprint := TextVersion(encoded)
	s.mu.Lock()
	now := time.Now()
	if receipt, ok := s.saveReceipts[id]; ok && (receipt.version == "" || now.Before(receipt.expires)) {
		s.mu.Unlock()
		if receipt.kind != kind || receipt.path != rel || receipt.fingerprint != fingerprint {
			return SaveOperationStatus{}, nil, ErrSaveOperation
		}
		if receipt.version == "" {
			return SaveOperationStatus{}, nil, ErrBusy
		}
		return SaveOperationStatus{Status: "saved", Version: receipt.version}, nil, nil
	}
	delete(s.saveReceipts, id)
	oldestID := ""
	var oldest time.Time
	for key, receipt := range s.saveReceipts {
		if receipt.version == "" {
			continue
		}
		if !now.Before(receipt.expires) {
			delete(s.saveReceipts, key)
			continue
		}
		if oldestID == "" || receipt.expires.Before(oldest) {
			oldestID, oldest = key, receipt.expires
		}
	}
	if len(s.saveReceipts) >= maxSaveReceipts {
		if oldestID == "" {
			s.mu.Unlock()
			return SaveOperationStatus{}, nil, ErrBusy
		}
		delete(s.saveReceipts, oldestID)
	}
	s.saveReceipts[id] = saveReceipt{kind: kind, path: rel, fingerprint: fingerprint, started: now}
	s.mu.Unlock()
	cleanup := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if receipt, ok := s.saveReceipts[id]; ok && receipt.version == "" && receipt.started == now {
			delete(s.saveReceipts, id)
		}
	}
	return SaveOperationStatus{Status: "pending"}, cleanup, nil
}

// Called while mu is held, in the same critical section as publication.
func (s *FileService) confirmSaveOperation(id, version string) {
	if id == "" {
		return
	}
	receipt := s.saveReceipts[id]
	receipt.version = version
	receipt.expires = time.Now().Add(saveReceiptLifetime)
	s.saveReceipts[id] = receipt
}

func (s *FileService) saveOperationStatus(kind, filename, id string) SaveOperationStatus {
	rel := filepath.ToSlash(s.RelativePath(filename))
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.saveReceipts[id]
	if ok && receipt.version != "" && !time.Now().Before(receipt.expires) {
		delete(s.saveReceipts, id)
		ok = false
	}
	if !ok || rel == "" || receipt.path != rel || receipt.kind != kind {
		return SaveOperationStatus{Status: "unknown"}
	}
	if receipt.version == "" {
		return SaveOperationStatus{Status: "pending"}
	}
	return SaveOperationStatus{Status: "saved", Version: receipt.version}
}
