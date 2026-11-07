package logging

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"uuid"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/gin-gonic/gin"
)

func testRouter(t *testing.T, settings config.LoggingSettings, out *bytes.Buffer) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	logger, _, err := New(settings, out)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(HTTP(logger, settings), Recovery())
	return r
}

func TestRequestIDsAndPrivateData(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.Format = "json"
	r := testRouter(t, settings, &out)
	r.POST("/files/*filename", func(c *gin.Context) {
		WithRequestFields(c, "session_id", "session-for-test")
		FromContext(c.Request.Context()).Info("operation", "event", "operation.test")
		c.String(200, "PRIVATE_RESPONSE")
	})
	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/files/PRIVATE_FILENAME?token=PRIVATE_QUERY", strings.NewReader("PRIVATE_BODY"))
		req.Header.Set("X-Request-ID", "PRIVATE_CLIENT_ID")
		req.Header.Set("Authorization", "PRIVATE_AUTH")
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		id := res.Header().Get("X-Request-ID")
		if _, err := uuid.Parse(id); err != nil || seen[id] {
			t.Fatalf("bad request ID: %q %v", id, err)
		}
		seen[id] = true
		got := records(t, out.Bytes())
		business, access := got[len(got)-2], got[len(got)-1]
		if business["request_id"] != id || access["request_id"] != id || access["session_id"] != "session-for-test" {
			t.Fatal("request context lost")
		}
		if access["route"] != "/files/*filename" || access["status"] != float64(200) {
			t.Fatalf("access fields: %v", access)
		}
	}
	if bytes.Contains(out.Bytes(), []byte("PRIVATE_")) {
		t.Fatalf("private request/response data leaked: %s", out.String())
	}
}

func TestSuccessfulRequestFilteringAndFailureDetails(t *testing.T) {
	for _, verbose := range []bool{false, true} {
		var out bytes.Buffer
		settings := config.DefaultLoggingSettings()
		settings.Format, settings.LogPolling, settings.LogChunks = "json", verbose, verbose
		r := testRouter(t, settings, &out)
		r.GET("/api/clipboard", func(c *gin.Context) { c.Status(200) })
		r.GET("/api/files", func(c *gin.Context) {
			if c.Query("fail") != "" {
				c.Status(500)
			} else {
				c.Status(200)
			}
		})
		r.GET("/api/upload/status/:session_id", func(c *gin.Context) { c.Status(200) })
		r.POST("/api/upload/chunk", func(c *gin.Context) {
			if c.Query("fail") != "" {
				_ = c.Error(errors.New("disk write failed"))
				c.Status(507)
			} else {
				c.Status(200)
			}
		})
		for _, request := range []struct{ method, path string }{
			{http.MethodGet, "/api/clipboard"}, {http.MethodGet, "/api/files"}, {http.MethodGet, "/api/upload/status/id"}, {http.MethodPost, "/api/upload/chunk"},
		} {
			r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(request.method, request.path, nil))
		}
		got := records(t, out.Bytes())
		if (!verbose && len(got) != 0) || (verbose && len(got) != 4) {
			t.Fatalf("filtering: %v", got)
		}
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/upload/chunk?fail=true", nil))
		got = records(t, out.Bytes())
		last := got[len(got)-1]
		if last["level"] != "ERROR" || last["error"] != "disk write failed" || last["status"] != float64(507) {
			t.Fatalf("failure detail: %v", last)
		}
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/files?fail=true", nil))
		got = records(t, out.Bytes())
		last = got[len(got)-1]
		if last["level"] != "ERROR" || last["route"] != "/api/files" || last["status"] != float64(500) {
			t.Fatalf("file polling failure was hidden: %v", last)
		}
	}
}

func TestDisabledAccessStillReportsFailuresAtConfiguredLevels(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.Format, settings.AccessLog = "json", false
	r := testRouter(t, settings, &out)
	r.GET("/ok", func(c *gin.Context) { c.Status(200) })
	r.GET("/bad", func(c *gin.Context) { c.Status(400) })
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok", nil))
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/bad", nil))
	got := records(t, out.Bytes())
	if len(got) != 1 || got[0]["level"] != "WARN" {
		t.Fatalf("access disabled: %v", got)
	}
}

func TestPanicRecoveryDoesNotLogPanicValuesOrHeaders(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.Format = "json"
	r := testRouter(t, settings, &out)
	r.GET("/panic", func(c *gin.Context) { panic("PRIVATE_PANIC_VALUE") })
	req := httptest.NewRequest(http.MethodGet, "/panic?secret=PRIVATE_QUERY", nil)
	req.Header.Set("Authorization", "PRIVATE_AUTH")
	res := httptest.NewRecorder()
	r.ServeHTTP(res, req)
	if res.Code != 500 || res.Header().Get("X-Request-ID") == "" {
		t.Fatal("panic not recovered")
	}
	got := records(t, out.Bytes())
	if len(got) != 2 || got[0]["event"] != "http.panic" || got[0]["stack"] == "" || got[1]["status"] != float64(500) {
		t.Fatalf("panic details: %v", got)
	}
	if bytes.Contains(out.Bytes(), []byte("PRIVATE_")) {
		t.Fatalf("panic/request value leaked: %s", out.String())
	}
}
