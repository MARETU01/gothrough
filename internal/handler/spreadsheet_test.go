package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"uuid"

	"github.com/MARETU01/gothrough/internal/service"
	"github.com/xuri/excelize/v2"
)

func TestSpreadsheetHTTPReadSaveAndValidation(t *testing.T) {
	_, h := setup(t)
	book := excelize.NewFile()
	if err := book.SetCellStr("Sheet1", "A1", "original"); err != nil {
		t.Fatal(err)
	}
	buffer, err := book.WriteToBuffer()
	book.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.uploadDir, "表 格.xlsx"), buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	path := "/api/files/%E8%A1%A8%20%E6%A0%BC.xlsx?preview=info"
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
	var preview service.SpreadsheetPreview
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if res.Code != 200 || preview.Kind != "spreadsheet" || preview.Sheets[0].Cells["A1"].Value != "original" || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("preview: %d %s", res.Code, res.Body.String())
	}
	for _, tc := range []struct {
		body   string
		status int
	}{
		{`{"changes":[]}`, 428},
		{`{"version":"` + preview.Version + `","changes":[]}`, 400},
		{`{"version":"` + preview.Version + `","changes":[],"extra":true}`, 400},
		{`{"version":"` + preview.Version + `","changes":[]} {}`, 400},
		{strings.Repeat(" ", 512*1024+1), 413},
		{`{"version":"` + preview.Version + `","changes":[{"sheet":"Sheet1","cell":"A1","type":"text","value":"saved"}]}`, 200},
		{`{"version":"` + preview.Version + `","changes":[{"sheet":"Sheet1","cell":"A1","type":"text","value":"stale"}]}`, 409},
	} {
		req := httptest.NewRequest(http.MethodPut, "/api/spreadsheets/%E8%A1%A8%20%E6%A0%BC.xlsx", bytes.NewBufferString(tc.body))
		req.Header.Set("Content-Type", "application/json")
		res = httptest.NewRecorder()
		h.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("expected %d, got %d: %s", tc.status, res.Code, res.Body.String())
		}
	}
	if err := os.WriteFile(filepath.Join(h.uploadDir, "fake.xlsx"), []byte("PK-not-xlsx"), 0600); err != nil {
		t.Fatal(err)
	}
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/files/fake.xlsx?preview=info", nil))
	if res.Code != 415 || !strings.Contains(res.Body.String(), "SPREADSHEET_UNSUPPORTED") {
		t.Fatalf("fake: %d %s", res.Code, res.Body.String())
	}
}

func TestSpreadsheetOperationHTTPConfirmation(t *testing.T) {
	_, h := setup(t)
	book := excelize.NewFile()
	buffer, err := book.WriteToBuffer()
	book.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.uploadDir, "book.xlsx"), buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewV7().String()
	body := `{"operation_id":"` + id + `","version":"` + service.TextVersion(buffer.Bytes()) + `","changes":[{"sheet":"Sheet1","cell":"A1","type":"text","value":"saved"}]}`
	for attempt := range 2 {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/spreadsheets/book.xlsx", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(res, req)
		var result service.SpreadsheetSaveResult
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if res.Code != 200 || result.Status != "saved" || result.Version == "" || (attempt == 0 && result.Preview == nil) || (attempt == 1 && result.Preview != nil) {
			t.Fatalf("save response: %d %s", res.Code, res.Body.String())
		}
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/spreadsheet-saves/"+id+"?filename=book.xlsx", nil))
	if res.Code != 200 || !strings.Contains(res.Body.String(), `"status":"saved"`) || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status: %d %s", res.Code, res.Body.String())
	}
}
