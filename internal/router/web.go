package router

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Only known client routes receive the SPA shell. Missing assets and API routes
// must remain 404 rather than returning HTML with a misleading success status.
func webHandler(assets fs.FS) gin.HandlerFunc {
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		panic("embedded frontend has no index.html: " + err.Error())
	}
	files := http.FileServer(http.FS(assets))
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		urlPath := c.Request.URL.Path
		switch urlPath {
		case "/", "/index.html", "/upload", "/upload/", "/files", "/files/":
			c.Header("Cache-Control", "no-cache")
			c.Header("Content-Type", "text/html; charset=utf-8")
			http.ServeContent(c.Writer, c.Request, "index.html", time.Time{}, bytes.NewReader(index))
			return
		}
		for _, prefix := range []string{"/api", "/upload", "/uploads", "/delete"} {
			if urlPath == prefix || strings.HasPrefix(urlPath, prefix+"/") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
		}
		name := strings.TrimPrefix(urlPath, "/")
		if !fs.ValidPath(name) || path.Clean(name) != name {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		for _, part := range strings.Split(name, "/") {
			if strings.HasPrefix(part, ".") {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
		}
		info, err := fs.Stat(assets, name)
		if err != nil || !info.Mode().IsRegular() {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Header("X-Content-Type-Options", "nosniff")
		if strings.HasPrefix(name, "assets/") {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "no-cache")
		}
		files.ServeHTTP(c.Writer, c.Request)
	}
}
