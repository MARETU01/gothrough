package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Our validators contain hexadecimal digits only, so commas safely separate tags.
// GET uses weak comparison, including wildcard and multiple header values.
func respondNotModified(c *gin.Context, etag string) bool {
	c.Header("Cache-Control", "no-store")
	c.Header("ETag", etag)
	for _, value := range c.Request.Header.Values("If-None-Match") {
		for _, candidate := range strings.Split(value, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
				c.Status(http.StatusNotModified)
				return true
			}
		}
	}
	return false
}
