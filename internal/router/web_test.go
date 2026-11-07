package router

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

func TestWebPrecompressedAssets(t *testing.T) {
	plain := []byte(strings.Repeat("console.log('compressed frontend');\n", 100))
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(plain); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	compressed := buffer.Bytes()
	r := gin.New()
	r.GET("/api/test", func(c *gin.Context) { c.String(200, "API") })
	r.NoRoute(webHandler(fstest.MapFS{
		"index.html":          {Data: []byte("<html></html>")},
		"assets/app.js":       {Data: plain},
		"assets/app.js.gz":    {Data: compressed},
		"assets/app.css":      {Data: plain},
		"assets/app.css.gz":   {Data: compressed},
		"assets/small.js":     {Data: plain},
		"assets/orphan.js.gz": {Data: compressed},
	}))
	for _, test := range []struct {
		accept string
		gzip   bool
		status int
	}{
		{"", false, 200},
		{"br", false, 200},
		{"gzip, deflate, br", true, 200},
		{"GZip; q=1", true, 200},
		{"*", true, 200},
		{"gzip;q=0", false, 200},
		{"gzip;q=0, *;q=1", false, 200},
		{"gzip;q=0.2, identity;q=0.8", false, 200},
		{"gzip;q=0.8, identity;q=0.2", true, 200},
		{"gzip;q=0.5, identity;q=0", true, 200},
		{"*;q=0, gzip;q=1", true, 200},
		{"*;q=0", false, 406},
		{"gzip;q=0, identity;q=0", false, 406},
		{"gzip;q=invalid", false, 200},
		{"gzip;q=NaN", false, 200},
	} {
		t.Run(test.accept, func(t *testing.T) {
			for _, method := range []string{"GET", "HEAD"} {
				req := httptest.NewRequest(method, "/assets/app.js", nil)
				req.Header.Set("Accept-Encoding", test.accept)
				res := httptest.NewRecorder()
				r.ServeHTTP(res, req)
				if res.Code != test.status || res.Header().Get("Vary") != "Accept-Encoding" || (res.Header().Get("Content-Encoding") == "gzip") != test.gzip {
					t.Fatalf("%s: %d %v", method, res.Code, res.Header())
				}
				if res.Code != 200 {
					if res.Header().Get("Cache-Control") != "no-store" {
						t.Fatal("negotiation error was cached")
					}
					continue
				}
				if !strings.Contains(res.Header().Get("Content-Type"), "javascript") || !strings.Contains(res.Header().Get("Cache-Control"), "immutable") {
					t.Fatalf("missing asset headers: %v", res.Header())
				}
				if method == "HEAD" {
					if res.Body.Len() != 0 {
						t.Fatal("HEAD returned a body")
					}
				} else if test.gzip {
					reader, err := gzip.NewReader(res.Body)
					if err != nil {
						t.Fatal(err)
					}
					decoded, err := io.ReadAll(reader)
					reader.Close()
					if err != nil || !bytes.Equal(decoded, plain) {
						t.Fatalf("bad gzip body: %v", err)
					}
				} else if !bytes.Equal(res.Body.Bytes(), plain) {
					t.Fatal("identity body changed")
				}
				if test.gzip && res.Header().Get("Content-Length") != strconv.Itoa(len(compressed)) {
					t.Fatal("wrong compressed content length")
				}
			}
		})
	}

	for _, test := range []struct {
		path, accept, rangeHeader string
		status                    int
		encoding, contentType     string
	}{
		{"/assets/app.css", "gzip", "", 200, "gzip", "text/css"},
		{"/assets/small.js", "gzip", "", 200, "", "javascript"},
		{"/assets/small.js", "gzip, identity;q=0", "", 406, "", ""},
		{"/assets/app.js.gz", "gzip", "", 404, "", ""},
		{"/assets/orphan.js", "gzip", "", 404, "", ""},
		{"/assets/missing.js", "gzip", "", 404, "", ""},
		{"/api/test", "gzip", "", 200, "", "text/plain"},
		{"/assets/app.js", "gzip", "bytes=0-9", 206, "gzip", "javascript"},
		{"/assets/app.js", "gzip", "bytes=999999-", 416, "", "text/plain"},
	} {
		t.Run(test.path+test.rangeHeader+test.accept, func(t *testing.T) {
			req := httptest.NewRequest("GET", test.path, nil)
			req.Header.Set("Accept-Encoding", test.accept)
			req.Header.Set("Range", test.rangeHeader)
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			if res.Code != test.status || res.Header().Get("Content-Encoding") != test.encoding || !strings.Contains(res.Header().Get("Content-Type"), test.contentType) {
				t.Fatalf("%d %v", res.Code, res.Header())
			}
			if res.Code == 206 && !bytes.Equal(res.Body.Bytes(), compressed[:10]) {
				t.Fatal("range did not refer to compressed representation")
			}
		})
	}
}

func TestWebRouting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	assets := fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html><title>GoThrough</title>")},
		"assets/app-abc123.js": {Data: []byte("console.log('embedded')")},
		"favicon.svg":          {Data: []byte("<svg/>")},
		".secret":              {Data: []byte("private")},
		"api/private.txt":      {Data: []byte("private")},
	}
	r := gin.New()
	r.GET("/api/test", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	r.NoRoute(webHandler(assets))
	for _, path := range []string{"/", "/index.html", "/upload", "/upload/", "/files", "/files/", "/clipboard", "/clipboard/"} {
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			t.Run(method+path, func(t *testing.T) {
				response := httptest.NewRecorder()
				r.ServeHTTP(response, httptest.NewRequest(method, path, nil))
				if response.Code != 200 || !strings.Contains(response.Header().Get("Content-Type"), "text/html") || response.Header().Get("Cache-Control") != "no-cache" {
					t.Fatalf("bad SPA response: %d %v", response.Code, response.Header())
				}
				if method == http.MethodGet && !strings.Contains(response.Body.String(), "GoThrough") {
					t.Fatal("missing SPA shell")
				}
				if method == http.MethodHead && response.Body.Len() != 0 {
					t.Fatal("HEAD returned body")
				}
			})
		}
	}
	for _, path := range []string{"/api/missing", "/api/private.txt", "/upload/unknown", "/uploads/unknown", "/delete/unknown", "/assets/missing.js", "/assets/", "/.secret", "/../index.html", "/unknown"} {
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != 404 || strings.Contains(response.Body.String(), "GoThrough") {
			t.Fatalf("%s unexpectedly fell back: %d", path, response.Code)
		}
	}
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/files", nil))
	if response.Code != 404 {
		t.Fatal("POST fell back to SPA")
	}
	response = httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/test", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"ok":true`) {
		t.Fatal("API intercepted")
	}
}

func TestWebAssets(t *testing.T) {
	r := gin.New()
	r.NoRoute(webHandler(fstest.MapFS{
		"index.html":           {Data: []byte("<html></html>")},
		"assets/app-abc123.js": {Data: []byte("console.log('embedded')")},
		"favicon.svg":          {Data: []byte("<svg/>")},
	}))
	for _, path := range []string{"/assets/app-abc123.js", "/favicon.svg"} {
		res := httptest.NewRecorder()
		r.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != 200 || res.Body.Len() == 0 {
			t.Fatalf("asset: %d", res.Code)
		}
		if strings.HasPrefix(path, "/assets/") && !strings.Contains(res.Header().Get("Cache-Control"), "immutable") {
			t.Fatal("hashed asset not cached")
		}
		if path == "/favicon.svg" && res.Header().Get("Cache-Control") != "no-cache" {
			t.Fatal("public asset cached indefinitely")
		}
	}
	req := httptest.NewRequest("GET", "/assets/app-abc123.js", nil)
	req.Header.Set("Range", "bytes=0-6")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != 206 || res.Body.String() != "console" {
		t.Fatalf("range: %d %s", res.Code, res.Body.String())
	}
}
