package handler

import (
	"errors"
	"mime"
	"net/http"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *UploadHandler) DownloadFolder(c *gin.Context) {
	folder, err := h.uploadService.OpenFolder(c.Query("path"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, service.ErrFileInaccessible) {
			status = http.StatusNotFound
		}
		respondError(c, err, status, "FOLDER_INACCESSIBLE", "文件夹不存在或无法访问")
		return
	}
	defer folder.Close()
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": folder.Name + ".zip"}))
	if err := folder.WriteZIP(c.Request.Context(), c.Writer); err != nil {
		logging.FromContext(c.Request.Context()).Error("文件夹下载中断", "event", "folder.download_failed", "error", err)
		// net/http resets the stream/connection rather than completing a partial ZIP.
		panic(http.ErrAbortHandler)
	}
}
