package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"uuid"
)

func TestTextSaveReceiptDoesNotOverwriteLaterChanges(t *testing.T) {
	s := testService(t)
	path := filepath.Join(s.uploadDir, "file.txt")
	original := []byte("\ufeffold\r\n")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewV7().String()
	version := TextVersion(original)
	result, err := s.SaveTextOperation(context.Background(), "file.txt", version, "first\n", id)
	if err != nil || result.Status != "saved" {
		t.Fatalf("save: %v %v", result, err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "\ufefffirst\r\n" {
		t.Fatalf("format: %q %v", data, err)
	}
	if status := s.TextSaveStatus("file.txt", id); status != *result {
		t.Fatal(status)
	}
	if s.TextSaveStatus("other.txt", id).Status != "unknown" || s.SpreadsheetSaveStatus("file.txt", id).Status != "unknown" {
		t.Fatal("receipt crossed path or kind")
	}
	if _, err := s.SaveText("file.txt", result.Version, "later\n"); err != nil {
		t.Fatal(err)
	}
	replay, err := s.SaveTextOperation(context.Background(), "file.txt", version, "first\n", id)
	if err != nil || *replay != *result {
		t.Fatalf("replay: %v %v", replay, err)
	}
	data, _ = os.ReadFile(path)
	if string(data) != "\ufefflater\r\n" {
		t.Fatalf("later edit lost: %q", data)
	}
	if _, err := s.SaveTextOperation(context.Background(), "file.txt", version, "different", id); !errors.Is(err, ErrSaveOperation) {
		t.Fatal(err)
	}
	if _, err := s.SaveSpreadsheetOperation(context.Background(), "file.txt", version, nil, id); !errors.Is(err, ErrSaveOperation) {
		t.Fatal(err)
	}
	if err := s.DeleteFile("file.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveTextOperation(context.Background(), "file.txt", version, "first\n", id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("replay recreated a deleted file")
	}
}

func TestTextSaveOperationCancellationNoopAndConcurrentRetries(t *testing.T) {
	s := testService(t)
	path := filepath.Join(s.uploadDir, "file.txt")
	original := []byte("one\r\ntwo\n")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	version := TextVersion(original)
	id := uuid.NewV7().String()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.SaveTextOperation(ctx, "file.txt", version, "changed", id); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if s.TextSaveStatus("file.txt", id).Status != "unknown" {
		t.Fatal("cancelled operation left a receipt")
	}
	before, _ := os.Stat(path)
	result, err := s.SaveTextOperation(context.Background(), "file.txt", version, "one\ntwo\n", id)
	if err != nil || result.Version != version {
		t.Fatalf("no-op: %v %v", result, err)
	}
	after, _ := os.Stat(path)
	data, _ := os.ReadFile(path)
	if !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || string(data) != string(original) {
		t.Fatal("no-op changed file")
	}
	id = uuid.NewV7().String()
	var workers sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		workers.Go(func() {
			_, err := s.SaveTextOperation(context.Background(), "file.txt", version, "changed", id)
			results <- err
		})
	}
	workers.Wait()
	close(results)
	for err := range results {
		if err != nil && !errors.Is(err, ErrBusy) {
			t.Fatal(err)
		}
	}
	if s.TextSaveStatus("file.txt", id).Status != "saved" {
		t.Fatal("save not confirmed")
	}
}
