package service

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestCompletionReceiptDoesNotRepublishDeletedFile(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "lost-response.txt", 0)
	name, size, err := s.CompleteSession(info.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteFile(name); err != nil {
		t.Fatal(err)
	}
	retryName, retrySize, err := s.CompleteSession(info.SessionID)
	if err != nil || retryName != name || retrySize != size {
		t.Fatalf("receipt changed: %s %d %v", retryName, retrySize, err)
	}
	files, _, err := s.ListFiles()
	if err != nil || len(files) != 0 {
		t.Fatalf("retry recreated deleted file: %v %v", files, err)
	}
	receipt := s.completed[info.SessionID]
	receipt.expires = time.Now().Add(-time.Second)
	s.completed[info.SessionID] = receipt
	if _, _, err := s.CompleteSession(info.SessionID); !errors.Is(err, ErrSession) {
		t.Fatalf("expired receipt survived: %v", err)
	}
}

func TestCompletionReceiptsAreBoundedAndExpired(t *testing.T) {
	s := testService(t)
	now := time.Now()
	for i := range MaxCompletedSessions {
		id := fmt.Sprint(i)
		s.completed[id] = completedSession{result: model.UploadCompletion{SessionID: id}, expires: now.Add(time.Minute + time.Duration(i)*time.Millisecond)}
	}
	s.rememberCompletion(model.UploadCompletion{SessionID: "new"})
	if len(s.completed) != MaxCompletedSessions {
		t.Fatal("receipt cache exceeded capacity")
	}
	if _, ok := s.GetCompletion("0"); ok {
		t.Fatal("oldest receipt not evicted")
	}
	for id, receipt := range s.completed {
		receipt.expires = now.Add(-time.Second)
		s.completed[id] = receipt
	}
	s.ExpireIdle(time.Hour)
	if len(s.completed) != 0 {
		t.Fatal("expired receipts retained")
	}
}
