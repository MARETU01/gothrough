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

func assertPublicFailure(t *testing.T, res *httptest.ResponseRecorder, message string) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("non-JSON failure: %d %s: %v", res.Code, res.Body.String(), err)
	}
	if res.Code != 500 || body["error"] != message || res.Header().Get("X-Request-ID") == "" {
		t.Fatalf("unexpected failure: %d %s", res.Code, res.Body.String())
	}
	for _, path := range []string{config.UploadFolder, config.TempFolder} {
		for _, value := range body {
			if text, ok := value.(string); ok && path != "" && strings.Contains(text, path) {
				t.Fatalf("internal path leaked: %s", res.Body.String())
			}
		}
	}
	return body
}

func TestFileAPIsHideStorageFailures(t *testing.T) {
	_, h := setup(t)
	// Make OpenRoot and disk inspection fail on every supported platform.
	if err := os.Remove(config.UploadFolder); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ method, path, message string }{
		{http.MethodGet, "/api/files", "获取文件列表失败，请稍后重试"},
		{http.MethodGet, "/api/disk-info", "获取磁盘信息失败，请稍后重试"},
		{http.MethodGet, "/api/files/example.txt", "读取文件失败，请稍后重试"},
	} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(test.method, test.path, nil))
		assertPublicFailure(t, res, test.message)
	}
	// Deleting a directory is rejected by the service with an internal error.
	if err := os.MkdirAll(filepath.Join(config.UploadFolder, "folder"), 0700); err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/files/folder", nil))
	assertPublicFailure(t, res, "删除文件失败，请稍后重试")
}

func TestUploadCompleteHidesCauseInBothErrorFields(t *testing.T) {
	_, h := setup(t)
	info := initHTTP(t, h, "example.txt", 0)
	if err := os.Remove(config.UploadFolder); err != nil {
		t.Fatal(err)
	}
	request, _ := json.Marshal(map[string]string{"session_id": info.SessionID})
	res := post(t, h, "/api/upload/complete", "application/json", bytes.NewReader(request))
	body := assertPublicFailure(t, res, "上传失败，请稍后重试")
	if body["message"] != body["error"] || body["status"] != "failed" || body["saved_filename"] != info.FinalFilename {
		t.Fatalf("completion response fields changed: %s", res.Body.String())
	}
}

func TestUploadInitHidesStorageFailure(t *testing.T) {
	_, h := setup(t)
	if err := os.WriteFile(config.TempFolder, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	res := post(t, h, "/api/upload/init", "application/json", strings.NewReader(`{"filename":"example.txt","total_size":0}`))
	assertPublicFailure(t, res, "上传失败，请稍后重试")
}

func TestClipboardMutationsHideStorageFailures(t *testing.T) {
	_, h := setup(t)
	res := post(t, h, "/api/clipboard", "application/json", strings.NewReader(`{"text":"keep me"}`))
	var entry struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &entry); err != nil || res.Code != 201 {
		t.Fatalf("create: %d %s %v", res.Code, res.Body.String(), err)
	}
	history := filepath.Join(filepath.Dir(config.UploadFolder), "clipboard", "history.json")
	if err := os.Remove(history); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(history, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(history, "blocked"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ method, path string }{
		{http.MethodPost, "/api/clipboard"},
		{http.MethodDelete, "/api/clipboard/" + entry.ID},
		{http.MethodDelete, "/api/clipboard"},
	} {
		req := httptest.NewRequest(test.method, test.path, strings.NewReader(`{"text":"not saved"}`))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		body := assertPublicFailure(t, res, "剪贴板存储失败，请稍后重试")
		if strings.Contains(body["error"].(string), history) {
			t.Fatal("clipboard history path leaked")
		}
	}
}
