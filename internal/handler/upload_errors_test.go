package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

func TestUploadStorageFailureResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		err     error
		status  int
		message string
	}{
		{utils.ErrStorageFull, 507, utils.ErrStorageFull.Error()},
		{utils.ErrStoragePermission, 403, utils.ErrStoragePermission.Error()},
		{utils.ErrStorageReadOnly, 503, utils.ErrStorageReadOnly.Error()},
		{utils.ErrHardlinkUnsupported, 500, utils.ErrHardlinkUnsupported.Error()},
		{service.ErrPathConflict, 409, service.ErrPathConflict.Error()},
		{service.ErrPath, 400, service.ErrPath.Error()},
		{service.ErrChunk, 400, service.ErrChunk.Error()},
		{service.ErrSession, 404, service.ErrSession.Error()},
		{service.ErrBusy, 429, service.ErrBusy.Error()},
		{service.ErrPathDeleting, 409, service.ErrPathDeleting.Error()},
		{&http.MaxBytesError{Limit: 8}, 413, "请求体过大"},
		{errors.New("unexpected failure"), 500, "上传失败，请稍后重试"},
	} {
		res := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(res)
		cause := errors.Join(&os.PathError{Op: "write", Path: "/private/storage/payload", Err: errors.New("low-level detail")}, test.err)
		uploadError(c, cause)
		if res.Code != test.status {
			t.Fatalf("%v: status %d", test.err, res.Code)
		}
		var body struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || body.Error != test.message {
			t.Fatalf("unexpected public error: %s", res.Body.String())
		}
		if c.Errors.Last() == nil || c.Errors.Last().Err != cause {
			t.Fatal("full cause was not retained for request logging")
		}
		if test.status == 429 && res.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry guidance")
		}
	}
}

func TestInternalErrorLoggingKeepsCauseAndRequestID(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	r := gin.New()
	r.Use(logging.HTTP(logger, config.DefaultLoggingSettings()))
	cause := &os.PathError{Op: "write", Path: "/private/storage/payload", Err: errors.New("disk failure")}
	r.GET("/failure", func(c *gin.Context) { uploadError(c, cause) })
	res := httptest.NewRecorder()
	r.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/failure", nil))
	if res.Code != 500 || strings.Contains(res.Body.String(), cause.Path) || strings.Contains(res.Body.String(), "disk failure") {
		t.Fatalf("unsafe error response: %d %s", res.Code, res.Body.String())
	}
	var record struct {
		Error     string `json:"error"`
		RequestID string `json:"request_id"`
		Level     string `json:"level"`
	}
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record.Error != cause.Error() || record.RequestID == "" || record.RequestID != res.Header().Get("X-Request-ID") || record.Level != "ERROR" {
		t.Fatalf("missing diagnostic context: %s", output.String())
	}
}
