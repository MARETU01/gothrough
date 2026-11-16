package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/xuri/excelize/v2"
)

func workbookFixture(t *testing.T, s *FileService) []byte {
	t.Helper()
	book := excelize.NewFile()
	defer book.Close()
	if _, err := book.NewSheet("预算"); err != nil {
		t.Fatal(err)
	}
	for cell, value := range map[string]any{"A1": "<script>alert(1)</script>", "B2": 12.5, "C3": true} {
		if err := book.SetCellValue("Sheet1", cell, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := book.SetCellFormula("Sheet1", "D2", "B2*2"); err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellValue("预算", "A1", "00123"); err != nil {
		t.Fatal(err)
	}
	style, err := book.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}, NumFmt: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := book.SetCellStyle("Sheet1", "B2", "B2", style); err != nil {
		t.Fatal(err)
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, "book.xlsx"), buffer.Bytes(), 0640); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestSpreadsheetPreviewAndVersionedSave(t *testing.T) {
	s := testService(t)
	before := workbookFixture(t, s)
	preview, err := s.PreviewSpreadsheet(context.Background(), "book.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if preview.Version != TextVersion(before) || len(preview.Sheets) != 2 || preview.Sheets[0].Cells["B2"].Raw != "12.5" || preview.Sheets[0].Cells["C3"].Raw != "true" || preview.Sheets[0].Cells["D2"].Type != "readonly" {
		t.Fatalf("preview: %+v", preview)
	}
	if _, _, err := s.cachedFiles(); err != nil {
		t.Fatal(err)
	}
	result, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", preview.Version, []SpreadsheetChange{
		{Sheet: "Sheet1", Cell: "B2", Type: "number", Value: "21.5"},
		{Sheet: "Sheet1", Cell: "C3", Type: "boolean", Value: "false"},
		{Sheet: "预算", Cell: "A1", Type: "text", Value: "=WEBSERVICE(\"https://example.invalid\")"},
		{Sheet: "预算", Cell: "B1", Type: "text", Value: "00123"},
		{Sheet: "Sheet1", Cell: "A1", Type: "clear"},
	})
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(s.uploadDir, "book.xlsx"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Version == preview.Version || result.Version != TextVersion(after) || result.Sheets[0].Cells["B2"].Value != "21.50" {
		t.Fatalf("saved result: %+v", result)
	}
	book, err := excelize.OpenReader(bytes.NewReader(after))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	if formula, _ := book.GetCellFormula("预算", "A1"); formula != "" {
		t.Fatal("text became an executable formula")
	}
	if value, _ := book.GetCellValue("预算", "B1"); value != "00123" {
		t.Fatal("text lost leading zeros")
	}
	if formula, _ := book.GetCellFormula("Sheet1", "D2"); formula != "B2*2" {
		t.Fatal("formula lost")
	}
	style, _ := book.GetCellStyle("Sheet1", "B2")
	format, _ := book.GetStyle(style)
	if format.Font == nil || !format.Font.Bold || format.NumFmt != 2 {
		t.Fatal("style lost")
	}
	if s.listing != nil {
		t.Fatal("listing not invalidated")
	}
	entries, _ := os.ReadDir(s.uploadDir)
	if len(entries) != 1 {
		t.Fatal("temporary files leaked")
	}
	if _, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", preview.Version, []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "stale"}}); !errors.Is(err, ErrTextConflict) {
		t.Fatalf("stale save: %v", err)
	}
}

func TestSpreadsheetInvalidChangesAreAtomic(t *testing.T) {
	s := testService(t)
	before := workbookFixture(t, s)
	for _, change := range []SpreadsheetChange{
		{Sheet: "missing", Cell: "A1", Type: "text", Value: "x"},
		{Sheet: "Sheet1", Cell: "D2", Type: "text", Value: "replace formula"},
		{Sheet: "Sheet1", Cell: "CW1", Type: "text", Value: "outside"},
		{Sheet: "Sheet1", Cell: "A2001", Type: "text", Value: "outside"},
		{Sheet: "Sheet1", Cell: "A1", Type: "formula", Value: "1+1"},
		{Sheet: "Sheet1", Cell: "A1", Type: "number", Value: "NaN"},
		{Sheet: "Sheet1", Cell: "A1", Type: "number", Value: "0x1p2"},
		{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "bad\x01text"},
		{Sheet: "Sheet1", Cell: "A1", Type: "boolean", Value: "1"},
	} {
		_, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", TextVersion(before), []SpreadsheetChange{{Sheet: "预算", Cell: "B1", Type: "text", Value: "must not save"}, change})
		if !errors.Is(err, ErrSpreadsheetChange) {
			t.Fatalf("%+v: %v", change, err)
		}
		data, _ := os.ReadFile(filepath.Join(s.uploadDir, "book.xlsx"))
		if !bytes.Equal(data, before) {
			t.Fatal("invalid change modified original")
		}
	}
}

func TestSpreadsheetArchiveAdmissionAndReservations(t *testing.T) {
	s := testService(t)
	before := workbookFixture(t, s)
	first, err := s.admitSpreadsheet()
	if err != nil {
		t.Fatal(err)
	}
	defer first()
	second, err := s.admitSpreadsheet()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewSpreadsheet(context.Background(), "book.xlsx"); !errors.Is(err, ErrBusy) {
		t.Fatalf("unbounded admission: %v", err)
	}
	second()
	s.mu.Lock()
	s.deleting[nameKey("book.xlsx")] = true
	s.mu.Unlock()
	if err := s.replaceSpreadsheet(context.Background(), "book.xlsx", TextVersion(before), before); !errors.Is(err, ErrPathDeleting) {
		t.Fatalf("reservation ignored: %v", err)
	}
	s.mu.Lock()
	delete(s.deleting, nameKey("book.xlsx"))
	s.mu.Unlock()
	data := rewriteWorkbook(t, before, "[Content_Types].xml", func(data []byte) []byte {
		return bytes.ReplaceAll(data, []byte("spreadsheetml.sheet.main+xml"), []byte("ms-excel.sheet.macroEnabled.main+xml"))
	})
	if _, err := openSpreadsheet(context.Background(), data); !errors.Is(err, ErrSpreadsheet) {
		t.Fatalf("macro workbook: %v", err)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	if _, err := writer.CreateRaw(&zip.FileHeader{Name: "xl/large.xml", UncompressedSize64: maxSpreadsheetUnzip + 1}); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := validateSpreadsheetArchive(context.Background(), buffer.Bytes()); !errors.Is(err, ErrSpreadsheetLimit) {
		t.Fatalf("unzip limit: %v", err)
	}
}

func rewriteWorkbook(t *testing.T, data []byte, name string, transform func([]byte) []byte) []byte {
	t.Helper()
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range archive.File {
		r, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		if entry.Name == name {
			body = transform(body)
		}
		w, err := writer.Create(entry.Name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestSpreadsheetBoundsProtectionAndCancellation(t *testing.T) {
	s := testService(t)
	original := workbookFixture(t, s)
	for _, row := range []string{"A1048576", "XFD1"} {
		data := rewriteWorkbook(t, original, "xl/worksheets/sheet1.xml", func(data []byte) []byte { return bytes.ReplaceAll(data, []byte(`r="A1"`), []byte(`r="`+row+`"`)) })
		if _, err := openSpreadsheet(context.Background(), data); !errors.Is(err, ErrSpreadsheetLimit) {
			t.Fatalf("sparse %s: %v", row, err)
		}
	}
	book, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatal(err)
	}
	if err := book.ProtectSheet("Sheet1", &excelize.SheetProtectionOptions{}); err != nil {
		t.Fatal(err)
	}
	buffer, err := book.WriteToBuffer()
	book.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, "book.xlsx"), buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewSpreadsheet(context.Background(), "book.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Sheets[0].ReadOnly || !preview.Sheets[1].ReadOnly {
		t.Fatal("protection bypassed")
	}
	if _, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", preview.Version, []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: "x"}}); !errors.Is(err, ErrSpreadsheetChange) {
		t.Fatalf("protected save: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.PreviewSpreadsheet(ctx, "book.xlsx"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled: %v", err)
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, "fake.xlsx"), []byte("not a workbook"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewSpreadsheet(context.Background(), "fake.xlsx"); !errors.Is(err, ErrSpreadsheet) {
		t.Fatalf("fake: %v", err)
	}
}

func TestSpreadsheetConcurrentSavesAndDeletionDoNotOverwrite(t *testing.T) {
	s := testService(t)
	before := workbookFixture(t, s)
	var workers sync.WaitGroup
	results := make(chan error, 2)
	for _, text := range []string{"first", "second"} {
		workers.Go(func() {
			_, err := s.SaveSpreadsheet(context.Background(), "book.xlsx", TextVersion(before), []SpreadsheetChange{{Sheet: "Sheet1", Cell: "A1", Type: "text", Value: text}})
			results <- err
		})
	}
	workers.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrTextConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("%d successes, %d conflicts", success, conflict)
	}
	data, _ := s.spreadsheetBytes("book.xlsx")
	if err := s.DeleteFile("book.xlsx"); err != nil {
		t.Fatal(err)
	}
	if err := s.replaceSpreadsheet(context.Background(), "book.xlsx", TextVersion(data), before); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted file recreated: %v", err)
	}
}
