package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPreviewTypesAndLimits(t *testing.T) {
	_, h := setup(t)
	for _, tc := range []struct {
		name, body, kind string
		status           int
	}{
		{"代码.html", "<script>alert(1)</script>", "text", 200},
		{"document.pdf", "%PDF-1.4\nexample", "pdf", 200},
		{"song.mp3", "ID3example", "audio", 200},
		{"fake.png", "<html>not an image</html>", "", 415},
		{"unknown.exe", "MZexample", "", 415},
		{"binary.txt", "a\x00b", "", 415},
		{"encoding.txt", "\xff", "", 415},
		{"large.txt", strings.Repeat("x", (1<<20)+1), "", 413},
		{"empty.txt", "", "text", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(h.uploadDir, tc.name), []byte(tc.body), 0600); err != nil {
				t.Fatal(err)
			}
			res := httptest.NewRecorder()
			h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/files/"+url.PathEscape(tc.name)+"?preview=info", nil))
			if res.Code != tc.status {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
			if tc.status != 200 {
				return
			}
			var body struct{ Kind, Text string }
			if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Kind != tc.kind || (tc.kind == "text" && body.Text != tc.body) {
				t.Fatalf("unexpected preview: %+v", body)
			}
		})
	}
}

func TestPreviewInlineRangeAndDownload(t *testing.T) {
	_, h := setup(t)
	if err := os.WriteFile(filepath.Join(h.uploadDir, "sample.html"), []byte("<script>bad()</script>"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, preview := range []bool{false, true} {
		path := "/api/files/sample.html"
		if preview {
			path += "?preview=1"
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Range", "bytes=0-3")
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		if res.Code != http.StatusPartialContent || res.Body.String() != "<scr" {
			t.Fatalf("range: %d %s", res.Code, res.Body.String())
		}
		if preview {
			if res.Header().Get("Content-Type") != "text/plain; charset=utf-8" || !strings.HasPrefix(res.Header().Get("Content-Disposition"), "inline") || res.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal(res.Header())
			}
		} else if !strings.HasPrefix(res.Header().Get("Content-Disposition"), "attachment") {
			t.Fatal(res.Header())
		}
	}
	for _, path := range []string{"/api/files/missing.txt?preview=info", "/api/files/../secret.txt?preview=1"} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		if res.Code != 404 {
			t.Fatalf("%s: %d", path, res.Code)
		}
	}
}
