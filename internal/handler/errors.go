package handler

import (
	"net/http"

	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

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
