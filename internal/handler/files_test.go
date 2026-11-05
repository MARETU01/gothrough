package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/MARETU01/gothrough/internal/config"
)

func TestStorageEndpointsAndMissingDelete(t *testing.T) {
	_, h := setup(t)
	if err := os.WriteFile(filepath.Join(config.UploadFolder, "sample.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/files", "/api/disk-info"} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		if res.Code != http.StatusOK {
			t.Fatalf("%s: %d", path, res.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"disk_total", "disk_used", "disk_free", "disk_total_display", "disk_used_display", "disk_free_display"} {
			if _, ok := body[key]; !ok {
				t.Fatalf("%s missing %s", path, key)
			}
		}
		if path == "/api/files" {
			if body["total_size"] != float64(5) || body["has_files"] != true {
				t.Fatalf("files: %v", body)
			}
		} else if body["uploads_size"] != float64(5) || body["uploads_count"] != float64(1) {
			t.Fatalf("disk-info: %v", body)
		}
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/files/missing.txt", nil))
	if res.Code != http.StatusNotFound {
		t.Fatalf("missing delete: %d", res.Code)
	}
}
