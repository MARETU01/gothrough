package handler

import "github.com/gin-gonic/gin"

// Keep the full cause for request logging, but only send a deliberate public
// message to clients. Never derive that message from an unknown error string.
func respondError(c *gin.Context, err error, status int, code, message string) {
	if err != nil {
		_ = c.Error(err)
	}
	c.JSON(status, gin.H{"code": code, "error": message})
}
