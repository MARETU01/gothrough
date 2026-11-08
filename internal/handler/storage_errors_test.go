package handler

import (
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

func TestStorageErrorsKeepCodesAcrossOperationsAndRedactCauses(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{utils.ErrStorageFull, 507, "STORAGE_FULL"},
		{utils.ErrStoragePermission, 403, "STORAGE_PERMISSION"},
		{utils.ErrStorageReadOnly, 503, "STORAGE_READ_ONLY"},
		{utils.ErrHardlinkUnsupported, 500, "HARDLINK_UNSUPPORTED"},
	} {
		for _, operation := range []struct{ code, message string }{
			{"UPLOAD_FAILED", "upload fallback"}, {"TEXT_SAVE_FAILED", "edit fallback"},
		} {
			cause := &os.PathError{Op: "write", Path: "/private/data", Err: tc.err}
			status, code, message := storageErrorDetails(cause, operation.code, operation.message)
			if status != tc.status || code != tc.code || message != tc.err.Error() {
				t.Fatalf("%s: %d %s %s", operation.code, status, code, message)
			}
			res := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(res)
			respondError(c, cause, status, code, message)
			if strings.Contains(res.Body.String(), cause.Path) || c.Errors.Last().Err != cause {
				t.Fatal("lost full cause or disclosed storage details")
			}
		}
	}
	for _, fallback := range []string{"UPLOAD_FAILED", "TEXT_SAVE_FAILED"} {
		status, code, message := storageErrorDetails(errors.New("private failure"), fallback, "public fallback")
		if status != 500 || code != fallback || message != "public fallback" {
			t.Fatalf("unexpected fallback: %d %s %s", status, code, message)
		}
	}
}
