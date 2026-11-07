package service

import (
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

const CompletionLifetime = time.Hour
const MaxCompletedSessions = 4096

type completedSession struct {
	result  model.UploadCompletion
	expires time.Time
}

// GetCompletion returns the original receipt, even if the response was lost or
// the file was subsequently renamed/deleted. Never publish it a second time.
func (s *UploadService) GetCompletion(id string) (model.UploadCompletion, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.completed[id]
	if ok && !time.Now().Before(receipt.expires) {
		delete(s.completed, id)
		ok = false
	}
	return receipt.result, ok
}

func (s *UploadService) rememberCompletion(result model.UploadCompletion) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	var oldestID string
	var oldest time.Time
	for id, receipt := range s.completed {
		if !now.Before(receipt.expires) {
			delete(s.completed, id)
			continue
		}
		if oldestID == "" || receipt.expires.Before(oldest) {
			oldestID, oldest = id, receipt.expires
		}
	}
	if len(s.completed) >= MaxCompletedSessions {
		delete(s.completed, oldestID)
	}
	s.completed[result.SessionID] = completedSession{result: result, expires: now.Add(CompletionLifetime)}
}
