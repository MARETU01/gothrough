package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/model"
)

func TestConditionalFileListAndIndependentDiskInfo(t *testing.T) {
	s, h := setup(t)
	read := func(path, etag string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if etag != "" {
			req.Header.Set("If-None-Match", etag)
		}
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	initial := read("/api/files?view=list", "")
	etag := initial.Header().Get("ETag")
	if initial.Code != 200 || etag == "" || initial.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("initial: %d %v", initial.Code, initial.Header())
	}
	var body map[string]any
	if err := json.Unmarshal(initial.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, exists := body["disk_free"]; exists {
		t.Fatal("volatile disk state must not be in the list snapshot")
	}
	for _, condition := range []string{etag, "W/" + etag, `"other", W/` + etag, "*"} {
		res := read("/api/files?view=list", condition)
		if res.Code != 304 || res.Body.Len() != 0 || res.Header().Get("ETag") != etag {
			t.Fatalf("conditional %s: %d %s", condition, res.Code, res.Body.String())
		}
	}
	disk := read("/api/disk-info", etag)
	if disk.Code != 200 {
		t.Fatal(disk.Code)
	}
	if err := json.Unmarshal(disk.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if _, exists := body["disk_pct"]; !exists {
		t.Fatal("missing independent disk percentage")
	}
	if res := read("/api/files?view=list", etag); res.Code != 304 {
		t.Fatal("disk reads changed list version")
	}
	// In-service publication, editing and deletion invalidate the cached snapshot.
	entry, err := s.InitSession(model.InitRequest{Filename: "edit.txt", TotalSize: 0})
	if err != nil {
		t.Fatal(err)
	}
	name, _, err := s.CompleteSession(entry.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	added := read("/api/files?view=list", etag)
	if added.Code != 200 || added.Header().Get("ETag") == etag {
		t.Fatal("upload did not change validator")
	}
	preview := read("/api/files/"+url.PathEscape(name)+"?preview=info", "")
	var info struct{ Version string }
	if err := json.Unmarshal(preview.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveText(name, info.Version, "updated"); err != nil {
		t.Fatal(err)
	}
	edited := read("/api/files?view=list", added.Header().Get("ETag"))
	if edited.Code != 200 || edited.Header().Get("ETag") == added.Header().Get("ETag") {
		t.Fatal("edit did not change validator")
	}
	if err := s.DeleteFile(name); err != nil {
		t.Fatal(err)
	}
	if res := read("/api/files?view=list", edited.Header().Get("ETag")); res.Code != 200 {
		t.Fatal("delete did not change validator")
	}
}

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
			file := body["files"].([]any)[0].(map[string]any)
			if _, err := time.Parse(time.RFC3339Nano, file["mtime"].(string)); err != nil {
				t.Fatalf("mtime must include timezone: %v", file["mtime"])
			}
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
