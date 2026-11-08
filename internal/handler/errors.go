package handler

import (
	"errors"
	"net/http"

	"github.com/MARETU01/gothrough/internal/service"
	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

// File operations share public storage failures, but supply their own fallback.
// Unknown causes are retained by respondError and never become client messages.
func storageErrorDetails(err error, fallbackCode, fallbackMessage string) (int, string, string) {
	switch {
	case errors.Is(err, utils.ErrStorageFull):
		return http.StatusInsufficientStorage, "STORAGE_FULL", utils.ErrStorageFull.Error()
	case errors.Is(err, utils.ErrStoragePermission):
		return http.StatusForbidden, "STORAGE_PERMISSION", utils.ErrStoragePermission.Error()
	case errors.Is(err, utils.ErrStorageReadOnly):
		return http.StatusServiceUnavailable, "STORAGE_READ_ONLY", utils.ErrStorageReadOnly.Error()
	case errors.Is(err, utils.ErrHardlinkUnsupported):
		return http.StatusInternalServerError, "HARDLINK_UNSUPPORTED", utils.ErrHardlinkUnsupported.Error()
	}
	return http.StatusInternalServerError, fallbackCode, fallbackMessage
}

func busyErrorDetails(c *gin.Context) (int, string, string) {
	c.Header("Retry-After", "1")
	return http.StatusTooManyRequests, "SERVER_BUSY", service.ErrBusy.Error()
}

func respondBusy(c *gin.Context, err error) {
	status, code, message := busyErrorDetails(c)
	respondError(c, err, status, code, message)
}

// Keep the full cause for request logging, but only send a deliberate public
// message to clients. Never derive that message from an unknown error string.
func respondError(c *gin.Context, err error, status int, code, message string) {
	if err != nil {
		_ = c.Error(err)
	}
	c.JSON(status, gin.H{"code": code, "error": message})
}
