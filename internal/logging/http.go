package logging

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"time"
	"uuid"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/gin-gonic/gin"
)

func WithRequestFields(c *gin.Context, fields ...any) {
	ctx := context.WithValue(c.Request.Context(), loggerKey{}, FromContext(c.Request.Context()).With(fields...))
	c.Request = c.Request.WithContext(ctx)
}

func HTTP(logger *slog.Logger, settings config.LoggingSettings) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		id := uuid.NewV7().String()
		c.Header("X-Request-ID", id)
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), loggerKey{}, logger.With("request_id", id)))
		c.Next()
		status, route := c.Writer.Status(), c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		if status < 400 {
			if !settings.AccessLog {
				return
			}
			if !settings.LogChunks && route == "/api/upload/chunk" {
				return
			}
			if !settings.LogPolling && c.Request.Method == http.MethodGet && (route == "/api/files" || route == "/api/disk-info" || route == "/api/clipboard" || route == "/api/upload/status/:session_id") {
				return
			}
		}
		level := slog.LevelInfo
		if status >= 500 {
			level = slog.LevelError
		} else if status >= 400 {
			level = slog.LevelWarn
		}
		remoteIP, _, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err != nil {
			remoteIP = c.Request.RemoteAddr
		}
		fields := []any{"event", "http.request", "method", c.Request.Method, "route", route, "status", status,
			"duration_ms", float64(time.Since(start).Microseconds()) / 1000, "remote_ip", remoteIP, "response_bytes", c.Writer.Size()}
		if last := c.Errors.Last(); last != nil {
			fields = append(fields, "error", last.Err)
		}
		FromContext(c.Request.Context()).Log(c.Request.Context(), level, "HTTP 请求完成", fields...)
	}
}

// Recovery intentionally omits panic values, headers and request bodies.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if value := recover(); value != nil {
				FromContext(c.Request.Context()).Error("HTTP 请求发生 panic", "event", "http.panic", "panic_type", fmt.Sprintf("%T", value), "stack", string(debug.Stack()))
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()
		c.Next()
	}
}
