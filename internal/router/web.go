package router

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strconv"
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
		case "/", "/index.html", "/upload", "/upload/", "/files", "/files/", "/clipboard", "/clipboard/":
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
		if !fs.ValidPath(name) || path.Clean(name) != name || strings.HasSuffix(name, ".gz") {
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
		if !serveCompressedWebAsset(c, assets, name) {
			files.ServeHTTP(c.Writer, c.Request)
		}
	}
}

// Only frontend code is compressed; upload/download APIs never pass through here.
func serveCompressedWebAsset(c *gin.Context, assets fs.FS, name string) bool {
	if ext := path.Ext(name); ext != ".js" && ext != ".css" {
		return false
	}
	c.Writer.Header().Add("Vary", "Accept-Encoding")
	accepted := strings.Join(c.Request.Header.Values("Accept-Encoding"), ",")
	gzipQuality := webEncodingQuality(accepted, "gzip")
	identityQuality := webEncodingQuality(accepted, "identity")
	if gzipQuality > 0 && gzipQuality >= identityQuality {
		if compressed, err := fs.ReadFile(assets, name+".gz"); err == nil {
			c.Header("Content-Encoding", "gzip")
			c.Header("Content-Length", strconv.Itoa(len(compressed)))
			// Use the original filename so ServeContent selects the JS/CSS MIME type.
			http.ServeContent(c.Writer, c.Request, name, time.Time{}, bytes.NewReader(compressed))
			return true
		}
	}
	if identityQuality == 0 {
		c.Header("Cache-Control", "no-store")
		c.AbortWithStatus(http.StatusNotAcceptable)
		return true
	}
	return false
}

// Explicit coding preferences override '*'; identity is acceptable by default.
func webEncodingQuality(header, encoding string) float64 {
	wildcard := -1.0
	for _, entry := range strings.Split(header, ",") {
		parts := strings.Split(entry, ";")
		coding := strings.TrimSpace(parts[0])
		if !strings.EqualFold(coding, encoding) && coding != "*" {
			continue
		}
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && strings.EqualFold(strings.TrimSpace(key), "q") {
				parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
				if err != nil || !(parsed >= 0 && parsed <= 1) {
					quality = 0
				} else {
					quality = parsed
				}
			}
		}
		if coding != "*" {
			return quality
		}
		wildcard = quality
	}
	if encoding == "identity" && wildcard != 0 {
		return 1
	}
	if wildcard >= 0 {
		return wildcard
	}
	return 0
}
