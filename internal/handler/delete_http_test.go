package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func deleteHTTP(t *testing.T, h http.Handler, name string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"entries": []map[string]any{{"path": name, "folder": false}}})
	if err != nil {
		t.Fatal(err)
	}
	res := post(t, h, "/api/batch-delete", "application/json", bytes.NewReader(body))
	var response struct {
		Results []struct {
			Path    string
			Deleted bool
		}
	}
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if res.Code != 200 || len(response.Results) != 1 || response.Results[0].Path != name || !response.Results[0].Deleted {
		t.Fatalf("delete %q: %d %s", name, res.Code, res.Body.String())
	}
	return res
}

func TestRemovedFileEndpointsDoNotMutateData(t *testing.T) {
	_, h := setup(t)
	file := filepath.Join(h.uploadDir, "keep.txt")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ method, path string }{
		{"DELETE", "/api/files/keep.txt"},
		{"GET", "/api/folder-download?path=docs"},
	} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(tc.method, tc.path, nil))
		if res.Code != 404 {
			t.Fatalf("removed endpoint: %d %s", res.Code, res.Body.String())
		}
		if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
			t.Fatalf("removed endpoint changed data: %q %v", data, err)
		}
	}
}
