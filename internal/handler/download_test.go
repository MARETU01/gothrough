package handler

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestDownloadAdmissionReleasesSlots(t *testing.T) {
	r := gin.New()
	limits := DownloadLimits(1, time.Second)
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	r.GET("/hold", limits, func(c *gin.Context) { close(entered); <-release; c.String(200, "done") })
	r.GET("/small", limits, func(c *gin.Context) { c.String(200, "small") })
	go func() {
		defer close(done)
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/hold", nil))
	}()
	<-entered
	blocked := httptest.NewRecorder()
	r.ServeHTTP(blocked, httptest.NewRequest("GET", "/small", nil))
	close(release)
	<-done
	if blocked.Code != 429 || blocked.Header().Get("Retry-After") == "" {
		t.Fatalf("admission: %d %s", blocked.Code, blocked.Body.String())
	}
	next := httptest.NewRecorder()
	r.ServeHTTP(next, httptest.NewRequest("GET", "/small", nil))
	if next.Code != 200 {
		t.Fatalf("slot leaked: %d", next.Code)
	}
}

func TestDownloadIdleDeadlineClosesFileAndAllowsProgress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.bin")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(32 << 20); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()
	entered, closed := make(chan struct{}), make(chan struct{})
	r := gin.New()
	limits := DownloadLimits(1, 100*time.Millisecond)
	r.GET("/large", limits, func(c *gin.Context) {
		file, err := os.Open(path)
		if err != nil {
			c.AbortWithStatus(500)
			return
		}
		defer func() { file.Close(); close(closed) }()
		close(entered)
		http.ServeContent(c.Writer, c.Request, "large.bin", time.Time{}, file)
	})
	r.GET("/progress", limits, func(c *gin.Context) {
		for range 10 {
			c.Writer.WriteString("x")
			c.Writer.Flush()
			time.Sleep(20 * time.Millisecond)
		}
	})
	server := httptest.NewServer(r)
	defer server.Close()
	conn, err := net.Dial("tcp", server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(1024)
	}
	if _, err := fmt.Fprintf(conn, "GET /large HTTP/1.1\r\nHost: localhost\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	<-entered
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("idle client retained the file")
	}
	// This response takes longer than the idle timeout but keeps making progress.
	client := &http.Client{Timeout: 3 * time.Second}
	var response *http.Response
	deadline := time.Now().Add(time.Second)
	for {
		response, err = client.Get(server.URL + "/progress")
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 429 {
			break
		}
		response.Body.Close()
		if time.Now().After(deadline) {
			t.Fatal("timeout leaked download slot")
		}
		time.Sleep(time.Millisecond)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || string(body) != strings.Repeat("x", 10) {
		t.Fatalf("progressing download interrupted: %d %q %v", response.StatusCode, body, err)
	}
}
