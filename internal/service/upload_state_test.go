package service

import (
	"errors"
	"sync"
	"testing"
)

func TestLookupUploadDuringCompletion(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "state.txt", 0)
	var workers sync.WaitGroup
	for range 24 {
		workers.Go(func() {
			state, err := s.LookupUpload(info.SessionID)
			if err != nil {
				t.Error(err)
				return
			}
			if (state.Session == nil) == (state.Completion == nil) {
				t.Error("expected exactly one upload state")
			}
			if state.Session != nil {
				state.Session.ReceivedSet[999] = true
			}
			if state.Completion != nil {
				state.Completion.SavedFilename = "modified snapshot"
			}
		})
	}
	if _, _, err := s.CompleteSession(info.SessionID); err != nil {
		t.Fatal(err)
	}
	workers.Wait()
	state, err := s.LookupUpload(info.SessionID)
	if err != nil || state.Completion == nil || state.Completion.SavedFilename != info.FinalFilename {
		t.Fatalf("completion state mutated: %v %v", state, err)
	}
	cancelled := smallSession(t, s, "cancelled.txt", 0)
	if err := s.CancelSession(cancelled.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LookupUpload(cancelled.SessionID); !errors.Is(err, ErrSession) {
		t.Fatalf("cancelled upload survived: %v", err)
	}
}
