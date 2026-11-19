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
)

func TestTextEditHTTP(t *testing.T) {
	_, h := setup(t)
	path := filepath.Join(h.uploadDir, "file.txt")
	if err := os.WriteFile(path, []byte("\ufeffold\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest("GET", "/api/files/file.txt?preview=info", nil))
	var preview struct{ Version, Text string }
	if err := json.Unmarshal(res.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	if preview.Version == "" || preview.Text != "old\n" {
		t.Fatalf("preview: %+v", preview)
	}
	for _, tc := range []struct {
		body   any
		status int
	}{
		{map[string]any{"text": "new\n"}, 428},
		{map[string]any{"version": preview.Version}, 400},
		{map[string]any{"text": strings.Repeat("x", (1<<20)+1), "version": preview.Version}, 413},
		{map[string]any{"text": "new\n", "version": preview.Version}, 200},
		{map[string]any{"text": "stale\n", "version": preview.Version}, 409},
	} {
		body, _ := json.Marshal(tc.body)
		res = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/files/file.txt", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("expected %d, got %d: %s", tc.status, res.Code, res.Body.String())
		}
	}
	data, _ := os.ReadFile(path)
	if string(data) != "\ufeffnew\r\n" {
		t.Fatalf("saved %q", data)
	}
}

func TestTextSaveOperationHTTP(t *testing.T) {
	_, h := setup(t)
	if err := os.WriteFile(filepath.Join(h.uploadDir, "file.txt"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	preview := httptest.NewRecorder()
	h.ServeHTTP(preview, httptest.NewRequest("GET", "/api/files/file.txt?preview=info", nil))
	var info struct{ Version string }
	if err := json.Unmarshal(preview.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewV7().String()
	body, _ := json.Marshal(map[string]string{"operation_id": id, "version": info.Version, "text": "new"})
	for range 2 {
		res := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/api/files/file.txt", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(res, req)
		if res.Code != 200 || !strings.Contains(res.Body.String(), `"status":"saved"`) {
			t.Fatalf("save: %d %s", res.Code, res.Body.String())
		}
	}
	for _, tc := range []struct {
		url     string
		status  int
		content string
	}{
		{"/api/text-saves/" + id + "?filename=file.txt", 200, `"status":"saved"`},
		{"/api/text-saves/" + id + "?filename=other.txt", 200, `"status":"unknown"`},
		{"/api/spreadsheet-saves/" + id + "?filename=file.txt", 200, `"status":"unknown"`},
		{"/api/text-saves/invalid?filename=file.txt", 409, `TEXT_OPERATION_CONFLICT`},
		{"/api/text-saves/" + id + "?filename=../file.txt", 409, `TEXT_OPERATION_CONFLICT`},
	} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest("GET", tc.url, nil))
		if res.Code != tc.status || !strings.Contains(res.Body.String(), tc.content) || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", tc.url, res.Code, res.Body.String())
		}
	}
}
