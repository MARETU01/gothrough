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

	"github.com/MARETU01/gothrough/internal/config"
)

func TestTextEditHTTP(t *testing.T) {
	_, h := setup(t)
	path := filepath.Join(config.UploadFolder, "file.txt")
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
