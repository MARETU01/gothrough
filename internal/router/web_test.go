package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/gin-gonic/gin"
)

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
	for _, path := range []string{"/", "/index.html", "/upload", "/upload/", "/files", "/files/"} {
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
