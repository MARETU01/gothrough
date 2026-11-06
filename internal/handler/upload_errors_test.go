package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MARETU01/gothrough/internal/service"
	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

func TestUploadStorageFailureResponses(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		err    error
		status int
	}{
		{utils.ErrStorageFull, 507}, {utils.ErrStoragePermission, 403}, {utils.ErrStorageReadOnly, 503},
		{utils.ErrHardlinkUnsupported, 500}, {service.ErrPathConflict, 409}, {service.ErrPath, 400},
		{service.ErrBusy, 429}, {&http.MaxBytesError{Limit: 8}, 413},
	} {
		res := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(res)
		uploadError(c, errors.Join(errors.New("上传失败"), test.err))
		if res.Code != test.status {
			t.Fatalf("%v: status %d", test.err, res.Code)
		}
		var body struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || body.Error == "" {
			t.Fatalf("missing error: %s", res.Body.String())
		}
		if test.status == 429 && res.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry guidance")
		}
	}
}
