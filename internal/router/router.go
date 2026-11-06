package router

import (
	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/logging"
	"log/slog"

	"github.com/gin-gonic/gin"
)

// 注册所有路由
func SetupRouter(h *handler.UploadHandler, clipboard *handler.ClipboardHandler, logSettings config.LoggingSettings) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(logging.HTTP(slog.Default(), logSettings), logging.Recovery())

	r.MaxMultipartMemory = config.MaxMultipartMemory

	api := r.Group("/api")
	{
		api.POST("/upload/init", h.UploadInit)
		api.POST("/upload/chunk", h.UploadChunk)
		api.GET("/upload/status/:session_id", h.UploadStatus)
		api.POST("/upload/complete", h.UploadComplete)
		api.POST("/upload/cancel", h.UploadCancel)
		api.GET("/files", h.ListUploads)
		api.GET("/files/*filename", h.DownloadUpload)
		api.DELETE("/files/*filename", h.DeleteFile)
		api.GET("/disk-info", h.DiskInfo)
		api.GET("/clipboard", clipboard.List)
		api.GET("/clipboard/image-config", clipboard.ImageConfig)
		api.POST("/clipboard/image", clipboard.CreateImage)
		api.GET("/clipboard/:id/image", clipboard.Image)
		api.POST("/clipboard", clipboard.Create)
		api.DELETE("/clipboard", clipboard.Clear)
		api.DELETE("/clipboard/:id", clipboard.Delete)
	}

	setupWeb(r)
	return r
}
