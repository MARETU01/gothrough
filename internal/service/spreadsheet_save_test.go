package service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
	"uuid"
)

func TestSpreadsheetSaveReceiptSurvivesLaterEditsAndDeletion(t *testing.T) {
	s := testService(t)
	original := workbookFixture(t, s)
	id := uuid.NewV7().String()
	changes := []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "first save"}}
	if status := s.SpreadsheetSaveStatus("book.xlsx", id); status.Status != "unknown" {
		t.Fatal(status)
	}
	result, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), changes, id)
	if err != nil || result.Preview == nil || result.Status != "saved" {
		t.Fatalf("save: %+v %v", result, err)
	}
	if status := s.SpreadsheetSaveStatus("book.xlsx", id); status.Status != "saved" || status.Version != result.Version {
		t.Fatal(status)
	}
	if status := s.SpreadsheetSaveStatus("another.xlsx", id); status.Status != "unknown" {
		t.Fatal("receipt crossed paths")
	}
	if _, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", "different", changes, id); !errors.Is(err, ErrSpreadsheetOperation) {
		t.Fatalf("identifier reused: %v", err)
	}
	latest, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", result.Version, []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "later save"}})
	if err != nil {
		t.Fatal(err)
	}
	beforeReplay, _ := os.ReadFile(filepath.Join(s.uploadDir, "book.xlsx"))
	replayed, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), changes, id)
	if err != nil || replayed.Preview != nil || replayed.Version != result.Version {
		t.Fatalf("receipt: %+v %v", replayed, err)
	}
	afterReplay, _ := os.ReadFile(filepath.Join(s.uploadDir, "book.xlsx"))
	if !bytes.Equal(beforeReplay, afterReplay) || TextVersion(afterReplay) != latest.Version {
		t.Fatal("replay overwrote later edit")
	}
	if err := s.DeleteFile("book.xlsx"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), changes, id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.uploadDir, "book.xlsx")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("receipt recreated deleted file")
	}
}

func TestSpreadsheetSaveConcurrentRetryAndFailureCleanup(t *testing.T) {
	s := testService(t)
	original := workbookFixture(t, s)
	id := uuid.NewV7().String()
	changes := []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "saved once"}}
	var workers sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), changes, id)
			results <- err
		})
	}
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrBusy) {
			t.Fatal(err)
		}
	}
	if successes == 0 || s.SpreadsheetSaveStatus("book.xlsx", id).Status != "saved" {
		t.Fatal("save not confirmed")
	}
	badID := uuid.NewV7().String()
	if _, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", "stale", changes, badID); !errors.Is(err, ErrTextConflict) {
		t.Fatal(err)
	}
	if s.SpreadsheetSaveStatus("book.xlsx", badID).Status != "unknown" {
		t.Fatal("failed operation left a receipt")
	}
	s.mu.Lock()
	receipt := s.saveReceipts[id]
	receipt.expires = time.Now().Add(-time.Second)
	s.saveReceipts[id] = receipt
	s.mu.Unlock()
	if s.SpreadsheetSaveStatus("book.xlsx", id).Status != "unknown" {
		t.Fatal("expired receipt retained")
	}
	if _, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), changes, id); !errors.Is(err, ErrTextConflict) {
		t.Fatalf("expired operation overwrote workbook: %v", err)
	}
}

func TestSpreadsheetSaveReceiptBoundAndPendingStatus(t *testing.T) {
	s := testService(t)
	original := workbookFixture(t, s)
	oldest := uuid.NewV7().String()
	for index := range maxSaveReceipts {
		id := uuid.NewV7().String()
		if index == 0 {
			id = oldest
		}
		s.saveReceipts[id] = saveReceipt{kind: "spreadsheet", path: "book.xlsx", version: "saved", expires: time.Now().Add(time.Duration(index+1) * time.Minute)}
	}
	result, err := s.SaveSpreadsheetOperation(context.Background(), "book.xlsx", TextVersion(original), []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "new save"}}, uuid.NewV7().String())
	if err != nil || result.Status != "saved" || len(s.saveReceipts) != maxSaveReceipts {
		t.Fatalf("bounded save: %v %v", result, err)
	}
	if _, ok := s.saveReceipts[oldest]; ok {
		t.Fatal("oldest receipt not evicted")
	}
	pending := uuid.NewV7().String()
	s.saveReceipts[pending] = saveReceipt{kind: "spreadsheet", path: "book.xlsx"}
	if s.SpreadsheetSaveStatus("book.xlsx", pending).Status != "pending" {
		t.Fatal("in-flight save reported unknown")
	}
}
