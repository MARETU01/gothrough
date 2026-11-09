package handler_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArchiveRoutesPreserveNestedFolderContracts(t *testing.T) {
	_, h := setup(t)
	dir := filepath.Join(h.uploadDir, "parent", "child")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "file.txt"), []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ route, filename, prefix string }{
		{"batch-download", "files.zip", "parent/child/"},
	} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest("GET", "/api/"+tc.route+"?path="+url.QueryEscape("parent/child"), nil))
		_, params, err := mime.ParseMediaType(res.Header().Get("Content-Disposition"))
		if res.Code != 200 || err != nil || params["filename"] != tc.filename || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %v %v", tc.route, res.Code, res.Header(), err)
		}
		archive, err := zip.NewReader(bytes.NewReader(res.Body.Bytes()), int64(res.Body.Len()))
		if err != nil {
			t.Fatal(err)
		}
		if len(archive.File) != 2 || archive.File[0].Name != tc.prefix || archive.File[1].Name != tc.prefix+"file.txt" {
			t.Fatalf("%s changed ZIP layout: %+v", tc.route, archive.File)
		}
	}
}

func TestSingleAndBatchDeletionInvalidateListingsAndKeepParents(t *testing.T) {
	for _, paths := range [][]string{{"existing/file%20.txt"}, {"existing/file%20.txt", "existing/other.txt"}} {
		_, h := setup(t)
		dir := filepath.Join(h.uploadDir, "existing")
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "file%20.txt"), []byte("content"), 0600); err != nil {
			t.Fatal(err)
		}
		if len(paths) > 1 {
			if err := os.WriteFile(filepath.Join(dir, "other.txt"), []byte("other"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		before := httptest.NewRecorder()
		h.ServeHTTP(before, httptest.NewRequest("GET", "/api/files?view=browser", nil))
		res := httptest.NewRecorder()
		entries := make([]map[string]any, len(paths))
		for i, name := range paths {
			entries[i] = map[string]any{"path": name, "folder": false}
		}
		body, _ := json.Marshal(map[string]any{"entries": entries})
		req := httptest.NewRequest("POST", "/api/batch-delete", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(res, req)
		if res.Code != 200 {
			t.Fatalf("delete: %d %s", res.Code, res.Body.String())
		}
		if _, err := os.Stat(filepath.Join(dir, "file%20.txt")); !os.IsNotExist(err) {
			t.Fatalf("file not deleted: %v", err)
		}
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("existing parent removed: %v", err)
		}
		after := httptest.NewRecorder()
		read := httptest.NewRequest("GET", "/api/files?view=browser", nil)
		read.Header.Set("If-None-Match", before.Header().Get("ETag"))
		h.ServeHTTP(after, read)
		if after.Code != 200 || after.Header().Get("ETag") == before.Header().Get("ETag") {
			t.Fatal("deletion left stale listing")
		}
	}
}

func TestUnknownFileViewDoesNotFallBackToFullListing(t *testing.T) {
	_, h := setup(t)
	for _, view := range []string{"list", "browesr"} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest("GET", "/api/files?view="+view, nil))
		if res.Code != 400 || !strings.Contains(res.Body.String(), `"code":"INVALID_FILE_QUERY"`) {
			t.Fatalf("unknown view: %d %s", res.Code, res.Body.String())
		}
	}
}

func TestDefaultFileListUsesBrowserContract(t *testing.T) {
	_, h := setup(t)
	first := httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest("GET", "/api/files", nil))
	second := httptest.NewRecorder()
	h.ServeHTTP(second, httptest.NewRequest("GET", "/api/files?view=browser", nil))
	if first.Code != 200 || second.Code != 200 || first.Body.String() != second.Body.String() || first.Header().Get("ETag") == "" || first.Header().Get("ETag") != second.Header().Get("ETag") {
		t.Fatalf("default and explicit browser responses differ: %d %s / %d %s", first.Code, first.Body.String(), second.Code, second.Body.String())
	}
}
