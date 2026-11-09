package handler_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBulkHTTPDownloadAndPartialDeletion(t *testing.T) {
	_, h := setup(t)
	for _, name := range []string{"文件.txt", "dir/child.txt"} {
		full := filepath.Join(h.uploadDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	response := httptest.NewRecorder()
	h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?path="+url.QueryEscape("文件.txt")+"&path=dir", nil))
	if response.Code != 200 || response.Header().Get("Content-Type") != "application/zip" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("download: %d %s", response.Code, response.Body.String())
	}
	archive, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil || len(archive.File) != 3 {
		t.Fatalf("archive: %+v %v", archive, err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/batch-delete", strings.NewReader(`{"entries":[{"path":"文件.txt","folder":false},{"path":"dir","folder":true},{"path":"missing.txt","folder":false}]}`))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	h.ServeHTTP(response, request)
	var body struct {
		Results []struct {
			Path    string
			Deleted bool
			Code    string
			Error   string
		}
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(body.Results) != 3 || !body.Results[0].Deleted || !body.Results[1].Deleted || body.Results[2].Code != "FILE_INACCESSIBLE" {
		t.Fatalf("delete: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(body.Results[2].Error, h.uploadDir) {
		t.Fatal("storage path exposed")
	}
}

func TestBulkHTTPRejectsInvalidSelectionsBeforeDeleting(t *testing.T) {
	_, h := setup(t)
	full := filepath.Join(h.uploadDir, "keep.txt")
	if err := os.WriteFile(full, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{}`, `{"entries":[]}`, `{"entries":[{"path":"keep.txt"},{"path":"../outside"}]}`, `{"entries":[{"path":"keep.txt"}]} {}`, `{"entries":[{"path":"keep.txt","folders":false}]}`, strings.Repeat(" ", 512*1024+1)} {
		req := httptest.NewRequest(http.MethodPost, "/api/batch-delete", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		h.ServeHTTP(response, req)
		if response.Code != 400 && response.Code != 413 {
			t.Fatalf("invalid selection: %d", response.Code)
		}
		if content, err := os.ReadFile(full); err != nil || string(content) != "keep" {
			t.Fatal("invalid selection deleted a valid item")
		}
	}
	for _, query := range []string{"", "path=../outside", "path=.", "path=keep.txt&path=missing", "path=keep.txt&path=keep.txt"} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?"+query, nil))
		if response.Code != 400 && response.Code != 404 {
			t.Fatalf("query %q: %d", query, response.Code)
		}
		if response.Header().Get("Content-Type") == "application/zip" {
			t.Fatal("invalid archive already started")
		}
	}
}
