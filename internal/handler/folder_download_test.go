package handler_test

import (
	"archive/zip"
	"bytes"
	"io"
	"mime"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestFolderDownloadZIP(t *testing.T) {
	_, router := setup(t)
	files := map[string]string{"照片/旅行/a.txt": "hello", "照片/空文件.txt": "", "other.txt": "excluded"}
	for name, content := range files {
		name = filepath.Join(router.uploadDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(router.uploadDir, "照片", "空目录"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, folder := range []string{"照片", "照片/旅行"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?path="+url.QueryEscape(folder), nil))
		if response.Code != 200 || response.Header().Get("Content-Type") != "application/zip" {
			t.Fatalf("download: %d %s", response.Code, response.Body.String())
		}
		_, params, err := mime.ParseMediaType(response.Header().Get("Content-Disposition"))
		if err != nil || params["filename"] != "files.zip" {
			t.Fatalf("filename: %v %v", params, err)
		}
		archive, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]string{}
		for _, entry := range archive.File {
			reader, err := entry.Open()
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(reader)
			reader.Close()
			if err != nil {
				t.Fatal(err)
			}
			got[entry.Name] = string(body)
		}
		prefix := folder
		expected := map[string]string{prefix + "/": "", prefix + "/a.txt": "hello"}
		if folder == "照片" {
			expected = map[string]string{"照片/": "", "照片/旅行/": "", "照片/旅行/a.txt": "hello", "照片/空文件.txt": "", "照片/空目录/": ""}
		}
		if len(got) != len(expected) {
			t.Fatalf("entries: %#v", got)
		}
		for name, content := range expected {
			if actual, ok := got[name]; !ok || actual != content {
				t.Fatalf("%s: %q, exists=%v", name, actual, ok)
			}
		}
	}
	for _, name := range []string{"", ".", "..", "../outside", "/照片", "missing", `..\outside`} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?path="+url.QueryEscape(name), nil))
		if response.Code != http.StatusNotFound && response.Code != http.StatusBadRequest {
			t.Errorf("%q: %d", name, response.Code)
		}
	}
}

func TestFolderDownloadSkipsSymlinks(t *testing.T) {
	_, router := setup(t)
	folder := filepath.Join(router.uploadDir, "folder")
	if err := os.Mkdir(folder, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(folder, "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(folder, "file-link")); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?path=folder", nil))
	archive, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 1 || archive.File[0].Name != "folder/" {
		t.Fatalf("unexpected entries: %+v", archive.File)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/batch-download?path=folder/link", nil))
	if response.Code != 404 {
		t.Fatalf("symlink accepted: %d", response.Code)
	}
}
