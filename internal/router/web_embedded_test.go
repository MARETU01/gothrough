//go:build embedweb

package router

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/webassets"
	"github.com/gin-gonic/gin"
)

func TestEmbeddedBuildIncludesFrontend(t *testing.T) {
	root := webassets.Assets()
	r := gin.New()
	setupWeb(r)
	for _, path := range []string{"/files", "/clipboard", "/clipboard/"} {
		res := httptest.NewRecorder()
		r.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != 200 || !strings.Contains(res.Body.String(), `id="root"`) {
			t.Fatalf("missing built SPA at %s: %d", path, res.Code)
		}
	}
	count := 0
	compressedCount := 0
	err := fs.WalkDir(root, "assets", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || strings.HasSuffix(name, ".gz") {
			return nil
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest("GET", "/"+name, nil))
		if response.Code != 200 || response.Body.Len() == 0 {
			t.Errorf("embedded asset unavailable: %s (%d)", name, response.Code)
		}
		count++
		if _, err := fs.Stat(root, name+".gz"); err == nil {
			req := httptest.NewRequest("GET", "/"+name, nil)
			req.Header.Set("Accept-Encoding", "gzip")
			encoded := httptest.NewRecorder()
			r.ServeHTTP(encoded, req)
			if encoded.Code != 200 || encoded.Header().Get("Content-Encoding") != "gzip" {
				t.Fatalf("compressed asset unavailable: %s (%d)", name, encoded.Code)
			}
			reader, err := gzip.NewReader(encoded.Body)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := io.ReadAll(reader)
			reader.Close()
			if err != nil || !bytes.Equal(decoded, response.Body.Bytes()) {
				t.Fatalf("compressed asset differs from original: %s (%v)", name, err)
			}
			compressedCount++
		}
		return nil
	})
	if err != nil || count == 0 {
		t.Fatalf("no embedded assets: count=%d err=%v", count, err)
	}
	if compressedCount == 0 {
		t.Fatal("build did not include precompressed frontend assets")
	}
}
