package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/router"
	"github.com/MARETU01/gothrough/internal/service"
)

type testRouter struct {
	http.Handler
	uploadDir string
	tempDir   string
}

func setup(t testing.TB) (*service.UploadService, *testRouter) {
	t.Helper()
	root := t.TempDir()
	uploadDir := filepath.Join(root, "uploads")
	tempDir := filepath.Join(root, "temp")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		t.Fatal(err)
	}
	s := service.NewUploadService(uploadDir, tempDir)
	t.Cleanup(s.Close)
	clipboard, err := service.NewClipboardService(filepath.Join(root, "clipboard"))
	if err != nil {
		t.Fatal(err)
	}
	return s, &testRouter{Handler: router.SetupRouter(handler.NewUploadHandler(s), handler.NewClipboardHandler(clipboard), config.DefaultLoggingSettings()), uploadDir: uploadDir, tempDir: tempDir}
}

func post(t *testing.T, h http.Handler, path, contentType string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, body)
	req.Header.Set("Content-Type", contentType)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	return res
}

func initHTTP(t *testing.T, h http.Handler, name string, size int) model.UploadSession {
	t.Helper()
	body, _ := json.Marshal(model.InitRequest{Filename: name, TotalSize: int64(size)})
	res := post(t, h, "/api/upload/init", "application/json", bytes.NewReader(body))
	if res.Code != 200 {
		t.Fatalf("init: %d %s", res.Code, res.Body.String())
	}
	var result model.UploadSession
	if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(res.Body.Bytes(), []byte(`"upload_transport":"raw"`)) {
		t.Fatalf("missing negotiation: %s", res.Body.String())
	}
	return result
}

func TestRawMultipartAndRangeDownload(t *testing.T) {
	_, h := setup(t)
	payload := bytes.Repeat([]byte("a"), config.ChunkSize+7)
	info := initHTTP(t, h, "测试文件.txt", len(payload))
	// Last block first, then multipart compatibility for the initial full block.
	path := fmt.Sprintf("/api/upload/chunk?session_id=%s&chunk_index=1", info.SessionID)
	if res := post(t, h, path, "application/octet-stream", bytes.NewReader(payload[config.ChunkSize:])); res.Code != 200 {
		t.Fatalf("raw: %d %s", res.Code, res.Body.String())
	}
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	_ = writer.WriteField("session_id", info.SessionID)
	_ = writer.WriteField("chunk_index", "0")
	part, err := writer.CreateFormFile("chunk", "part")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(payload[:config.ChunkSize])
	_ = writer.Close()
	if res := post(t, h, "/api/upload/chunk", writer.FormDataContentType(), &form); res.Code != 200 {
		t.Fatalf("multipart: %d %s", res.Code, res.Body.String())
	}
	req := httptest.NewRequest("GET", "/api/upload/status/"+info.SessionID, nil)
	status := httptest.NewRecorder()
	h.ServeHTTP(status, req)
	if status.Code != 200 {
		t.Fatal(status.Body.String())
	}
	complete := post(t, h, "/api/upload/complete", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"session_id":%q}`, info.SessionID)))
	if complete.Code != 200 {
		t.Fatalf("complete: %d %s", complete.Code, complete.Body.String())
	}
	got, err := os.ReadFile(filepath.Join(h.uploadDir, info.FinalFilename))
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("content mismatch: %v", err)
	}
	download := httptest.NewRequest("GET", "/api/files/"+info.FinalFilename, nil)
	download.Header.Set("Range", "bytes=2-5")
	res := httptest.NewRecorder()
	h.ServeHTTP(res, download)
	if res.Code != 206 || res.Body.String() != "aaaa" {
		t.Fatalf("range: %d %q", res.Code, res.Body.String())
	}
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/files/"+info.FinalFilename, nil))
	if res.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", res.Code, res.Body.String())
	}
	if _, err := os.Stat(filepath.Join(h.uploadDir, info.FinalFilename)); !os.IsNotExist(err) {
		t.Fatalf("deleted file still exists or cannot be checked: %v", err)
	}
}

func TestFileOperationsPreserveLiteralFilename(t *testing.T) {
	for _, tc := range []struct{ name, other string }{
		{"report%20.txt", "report .txt"},
		{"report%25.txt", "report%.txt"},
		{"report%2520.txt", "report%20.txt"},
		{"report%2F.txt", "report.txt"},
		{"中文 文件.txt", "中文%20文件.txt"},
		{"100%.txt", "100.txt"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, h := setup(t)
			for name, content := range map[string]string{tc.name: "target", tc.other: "untouched"} {
				if err := os.WriteFile(filepath.Join(h.uploadDir, name), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			path := "/api/files/" + url.PathEscape(tc.name)
			res := httptest.NewRecorder()
			h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
			if res.Code != http.StatusOK || res.Body.String() != "target" {
				t.Fatalf("download: %d %q", res.Code, res.Body.String())
			}
			res = httptest.NewRecorder()
			h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, path, nil))
			if res.Code != http.StatusOK {
				t.Fatalf("delete: %d %s", res.Code, res.Body.String())
			}
			if _, err := os.Stat(filepath.Join(h.uploadDir, tc.name)); !os.IsNotExist(err) {
				t.Fatalf("target was not deleted: %v", err)
			}
			if data, err := os.ReadFile(filepath.Join(h.uploadDir, tc.other)); err != nil || string(data) != "untouched" {
				t.Fatalf("other file was changed: %q %v", data, err)
			}
		})
	}
}

func TestFileOperationsRejectEncodedTraversal(t *testing.T) {
	_, h := setup(t)
	outside := filepath.Join(filepath.Dir(h.uploadDir), "outside.txt")
	if err := os.WriteFile(outside, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(method, "/api/files/%2e%2e%2foutside.txt", nil))
		if res.Code != http.StatusNotFound && res.Code != http.StatusForbidden {
			t.Fatalf("%s traversal: %d %s", method, res.Code, res.Body.String())
		}
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "untouched" {
		t.Fatalf("outside file was changed: %q %v", data, err)
	}
}

func TestFolderUploadHTTP(t *testing.T) {
	_, h := setup(t)
	path := "文件夹/子目录/报告%20.txt"
	body, _ := json.Marshal(model.InitRequest{Filename: "报告%20.txt", RelativePath: path, TotalSize: 5})
	res := post(t, h, "/api/upload/init", "application/json", bytes.NewReader(body))
	var info model.UploadSession
	if err := json.Unmarshal(res.Body.Bytes(), &info); err != nil || res.Code != http.StatusOK || info.FinalFilename != path {
		t.Fatalf("init: %d %s %v", res.Code, res.Body.String(), err)
	}
	res = post(t, h, "/api/upload/chunk?session_id="+info.SessionID+"&chunk_index=0", "application/octet-stream", bytes.NewBufferString("hello"))
	if res.Code != http.StatusOK {
		t.Fatalf("chunk: %d %s", res.Code, res.Body.String())
	}
	res = post(t, h, "/api/upload/complete", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"session_id":%q}`, info.SessionID)))
	if res.Code != http.StatusOK {
		t.Fatalf("complete: %d %s", res.Code, res.Body.String())
	}
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/files", nil))
	var list struct {
		Files     []model.FileInfo `json:"files"`
		TotalSize int64            `json:"total_size"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil || res.Code != http.StatusOK || len(list.Files) != 1 || list.Files[0].Name != path || list.TotalSize != 5 {
		t.Fatalf("list: %d %s %v", res.Code, res.Body.String(), err)
	}
	urlPath := "/api/files/" + url.PathEscape(path)
	res = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, urlPath, nil)
	req.Header.Set("Range", "bytes=1-3")
	h.ServeHTTP(res, req)
	if res.Code != http.StatusPartialContent || res.Body.String() != "ell" {
		t.Fatalf("download: %d %q", res.Code, res.Body.String())
	}
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, urlPath, nil))
	if res.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", res.Code, res.Body.String())
	}
	if _, err := os.Stat(filepath.Join(h.uploadDir, path)); !os.IsNotExist(err) {
		t.Fatalf("file not deleted: %v", err)
	}
	res = post(t, h, "/api/upload/init", "application/json", bytes.NewBufferString(`{"filename":"file.txt","relative_path":"../file.txt","total_size":0}`))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("traversal init: %d %s", res.Code, res.Body.String())
	}
}

func TestInvalidRawAndEmpty(t *testing.T) {
	s, h := setup(t)
	info := initHTTP(t, h, "small.txt", 4)
	path := fmt.Sprintf("/api/upload/chunk?session_id=%s&chunk_index=0", info.SessionID)
	for _, body := range []string{"abc", "abcde"} {
		res := post(t, h, path, "application/octet-stream", bytes.NewBufferString(body))
		if res.Code != 400 {
			t.Fatalf("invalid length: %d %s", res.Code, res.Body.String())
		}
	}
	res := post(t, h, "/api/upload/chunk?session_id=../../anything&chunk_index=0", "application/octet-stream", bytes.NewBufferString("data"))
	if res.Code != 404 {
		t.Fatal(res.Code)
	}
	empty := initHTTP(t, h, "empty.txt", 0)
	if _, size, err := s.CompleteSession(empty.SessionID); err != nil || size != 0 {
		t.Fatal(size, err)
	}
}

// Real loopback HTTP transport plus disk writes, with completion and cleanup.
// Browser/WAN throughput is still bounded by the user's network and reverse proxy.
func BenchmarkHTTPUpload(b *testing.B) {
	const blocks = 8
	chunk := bytes.Repeat([]byte{0x42}, config.ChunkSize)
	for _, workers := range []int{1, 3, 4} {
		b.Run(fmt.Sprintf("workers=%d", workers), func(b *testing.B) {
			s, h := setup(b)
			server := httptest.NewServer(h)
			defer server.Close()
			transport := &http.Transport{MaxIdleConnsPerHost: 8}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport}
			b.SetBytes(int64(blocks * len(chunk)))
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				info, err := s.InitSession(model.InitRequest{Filename: "bench.bin", TotalSize: int64(blocks * len(chunk))})
				if err != nil {
					b.Fatal(err)
				}
				jobs := make(chan int, blocks)
				for index := range blocks {
					jobs <- index
				}
				close(jobs)
				var wg sync.WaitGroup
				for range workers {
					wg.Go(func() {
						for index := range jobs {
							req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("%s/api/upload/chunk?session_id=%s&chunk_index=%d", server.URL, info.SessionID, index), bytes.NewReader(chunk))
							if err != nil {
								b.Error(err)
								return
							}
							req.Header.Set("Content-Type", "application/octet-stream")
							res, err := client.Do(req)
							if err != nil {
								b.Error(err)
								return
							}
							_, _ = io.Copy(io.Discard, res.Body)
							_ = res.Body.Close()
							if res.StatusCode != 200 {
								b.Errorf("HTTP %d", res.StatusCode)
							}
						}
					})
				}
				wg.Wait()
				name, _, err := s.CompleteSession(info.SessionID)
				if err != nil {
					b.Fatal(err)
				}
				if err := os.Remove(filepath.Join(h.uploadDir, name)); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
