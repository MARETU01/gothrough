//go:build embedweb

package router

import (
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
	res := httptest.NewRecorder()
	r.ServeHTTP(res, httptest.NewRequest("GET", "/files", nil))
	if res.Code != 200 || !strings.Contains(res.Body.String(), `id="root"`) {
		t.Fatalf("missing built SPA: %d", res.Code)
	}
	count := 0
	err := fs.WalkDir(root, "assets", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, httptest.NewRequest("GET", "/"+name, nil))
		if response.Code != 200 || response.Body.Len() == 0 {
			t.Errorf("embedded asset unavailable: %s (%d)", name, response.Code)
		}
		count++
		return nil
	})
	if err != nil || count == 0 {
		t.Fatalf("no embedded assets: count=%d err=%v", count, err)
	}
}
