package handler

import (
	"errors"
	"os"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *FileHandler) EditText(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	rel := h.uploadRelativePath(c)
	if rel == "" {
		return
	}
	var req struct {
		Text    *string `json:"text"`
		Version string  `json:"version"`
	}
	if err := bindLimitedJSON(c, &req, service.MaxTextBytes*6+4096, jsonCompatible); err != nil || req.Text == nil {
		if requestTooLarge(err) {
			respondError(c, err, 413, "TEXT_TOO_LARGE", "文本最大支持 1 MiB")
			return
		}
		respondError(c, err, 400, "INVALID_TEXT_EDIT", "无效的文本编辑请求")
		return
	}
	if req.Version == "" {
		respondError(c, nil, 428, "TEXT_VERSION_REQUIRED", "请重新加载文件后再保存")
		return
	}
	version, err := h.files.SaveText(rel, req.Version, *req.Text)
	if err != nil {
		switch {
		case errors.Is(err, service.ErrTextConflict):
			respondError(c, err, 409, "TEXT_CONFLICT", "文件已被修改，请重新加载后再编辑")
		case errors.Is(err, service.ErrTextSize):
			respondError(c, err, 413, "TEXT_TOO_LARGE", "文本最大支持 1 MiB")
		case errors.Is(err, service.ErrTextEncoding):
			respondError(c, err, 415, "PREVIEW_ENCODING", "仅支持 UTF-8 文本，请下载查看")
		case errors.Is(err, service.ErrTextType):
			respondError(c, err, 415, "TEXT_TYPE_UNSUPPORTED", "此文件类型不支持文本编辑")
		case errors.Is(err, os.ErrNotExist):
			respondError(c, err, 404, "FILE_NOT_FOUND", "文件不存在")
		default:
			status, code, msg := storageErrorDetails(err, "TEXT_SAVE_FAILED", "保存失败，请稍后重试")
			respondError(c, err, status, code, msg)
		}
		return
	}
	logging.FromContext(c.Request.Context()).Info("文本文件已保存", "event", "file.edited", "relative_path", rel)
	c.JSON(200, gin.H{"version": version})
}
