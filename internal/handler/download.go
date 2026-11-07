package handler

import (
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

const MaxConcurrentDownloads = 32
const DownloadIdleTimeout = 30 * time.Second

// DownloadLimits is shared by file downloads, previews, and clipboard images.
// Admission happens before opening files. Each bounded write gets a fresh idle
// deadline, so healthy large transfers have no fixed total duration limit.
func DownloadLimits(capacity int, idle time.Duration) gin.HandlerFunc {
	slots := make(chan struct{}, capacity)
	return func(c *gin.Context) {
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			respondBusy(c, nil)
			c.Abort()
			return
		}
		original := c.Writer
		controller := http.NewResponseController(original)
		writer := &downloadWriter{ResponseWriter: original, controller: controller, idle: idle}
		writer.refresh()
		c.Writer = writer
		defer func() {
			// Flush while the write deadline still applies, including the final buffered
			// bytes that net/http would otherwise flush after the middleware returns.
			if original.Written() {
				_ = controller.Flush()
			}
			_ = controller.SetWriteDeadline(time.Time{})
			c.Writer = original
		}()
		c.Next()
	}
}

type downloadWriter struct {
	gin.ResponseWriter
	controller *http.ResponseController
	idle       time.Duration
}

func (w *downloadWriter) refresh() { _ = w.controller.SetWriteDeadline(time.Now().Add(w.idle)) }

func (w *downloadWriter) Write(data []byte) (int, error) {
	total := 0
	// A renderer may pass a complete thumbnail/JSON buffer in one Write. Bound
	// each network write too so long, progressing writes can refresh the timer.
	for len(data) > 0 {
		size := min(len(data), 32*1024)
		w.refresh()
		n, err := w.ResponseWriter.Write(data[:size])
		total += n
		if err != nil {
			return total, err
		}
		data = data[n:]
		if n < size {
			return total, io.ErrShortWrite
		}
	}
	return total, nil
}

func (w *downloadWriter) WriteString(value string) (int, error) { return w.Write([]byte(value)) }
func (w *downloadWriter) Flush()                                { w.refresh(); w.ResponseWriter.Flush() }
func (w *downloadWriter) Unwrap() http.ResponseWriter           { return w.ResponseWriter }
