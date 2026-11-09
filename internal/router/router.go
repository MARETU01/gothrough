package router

import (
	"log/slog"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/logging"

	"github.com/gin-gonic/gin"
)

// 注册所有路由
func SetupRouter(h *handler.UploadHandler, files *handler.FileHandler, clipboard *handler.ClipboardHandler, logSettings config.LoggingSettings, authSettings ...config.AuthSettings) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(logging.HTTP(slog.Default(), logSettings), logging.Recovery())

	api := r.Group("/api")
	settings := config.AuthSettings{}
	if len(authSettings) > 0 {
		settings = authSettings[0]
	}
	// Gin trusts every proxy by default. Only explicit, validated proxy addresses
	// may supply forwarding headers for the login source limiter.
	if err := r.SetTrustedProxies(settings.TrustedProxies); err != nil {
		_ = r.SetTrustedProxies(nil)
		slog.Error("可信代理配置无效，已禁用转发头", "error", err)
	}
	auth := newAccessAuth(settings.Password)
	api.Use(auth.sameOrigin)
	api.GET("/auth/status", auth.status)
	api.POST("/auth/login", auth.login)
	api.POST("/auth/logout", auth.logout)
	api.Use(auth.requireSession)
	downloads := handler.DownloadLimits(handler.MaxConcurrentDownloads, handler.DownloadIdleTimeout)
	archives := handler.DownloadLimits(2, handler.DownloadIdleTimeout)
	{
		api.POST("/upload/init", h.UploadInit)
		api.POST("/upload/chunk", h.UploadChunk)
		api.GET("/upload/status/:session_id", h.UploadStatus)
		api.POST("/upload/complete", h.UploadComplete)
		api.POST("/upload/cancel", h.UploadCancel)
		api.GET("/files", files.ListFiles)
		api.GET("/batch-download", downloads, archives, files.DownloadSelection)
		api.POST("/batch-delete", files.DeleteSelection)
		api.GET("/files/*filename", downloads, files.DownloadUpload)
		api.PUT("/files/*filename", files.EditText)
		api.GET("/disk-info", files.DiskInfo)
		api.GET("/clipboard", clipboard.List)
		api.GET("/clipboard/image-config", clipboard.ImageConfig)
		api.POST("/clipboard/image", clipboard.CreateImage)
		api.GET("/clipboard/:id/image", downloads, clipboard.Image)
		api.POST("/clipboard", clipboard.Create)
		api.DELETE("/clipboard", clipboard.Clear)
		api.DELETE("/clipboard/:id", clipboard.Delete)
	}

	setupWeb(r)
	return r
}
