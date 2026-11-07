package handler

import (
	"errors"
	"net/http"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

type ClipboardHandler struct{ service *service.ClipboardService }

func NewClipboardHandler(s *service.ClipboardService) *ClipboardHandler {
	return &ClipboardHandler{service: s}
}

func (h *ClipboardHandler) List(c *gin.Context) {
	body, etag := h.service.Snapshot()
	if respondNotModified(c, etag) {
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(body))
}

func (h *ClipboardHandler) Create(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var req model.ClipboardRequest
	if err := bindLimitedJSON(c, &req, service.ClipboardMaxBytes*6+1024, jsonStrict); err != nil {
		invalidJSON(c, err, "INVALID_TEXT_REQUEST", "无效的文本请求")
		return
	}
	entry, err := h.service.Create(req.Text)
	if errors.Is(err, service.ErrClipboardText) {
		status := http.StatusBadRequest
		if len(req.Text) > service.ClipboardMaxBytes {
			status = http.StatusRequestEntityTooLarge
		}
		respondError(c, err, status, "INVALID_TEXT", service.ErrClipboardText.Error())
		return
	}
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "CLIPBOARD_SAVE_FAILED", "剪贴板存储失败，请稍后重试")
		return
	}
	logging.FromContext(c.Request.Context()).Info("剪贴板文本已发布", "event", "clipboard.created", "entry_id", entry.ID, "size_bytes", len(entry.Text))
	c.JSON(http.StatusCreated, entry)
}

func (h *ClipboardHandler) Delete(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	err := h.service.Delete(c.Param("id"))
	if errors.Is(err, service.ErrClipboardNotFound) {
		respondError(c, err, http.StatusNotFound, "CLIPBOARD_NOT_FOUND", service.ErrClipboardNotFound.Error())
		return
	}
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "CLIPBOARD_SAVE_FAILED", "剪贴板存储失败，请稍后重试")
		return
	}
	logging.FromContext(c.Request.Context()).Info("剪贴板记录已删除", "event", "clipboard.deleted", "entry_id", c.Param("id"))
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *ClipboardHandler) Clear(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if err := h.service.Clear(); err != nil {
		respondError(c, err, http.StatusInternalServerError, "CLIPBOARD_SAVE_FAILED", "剪贴板存储失败，请稍后重试")
		return
	}
	logging.FromContext(c.Request.Context()).Info("剪贴板记录已清空", "event", "clipboard.cleared")
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
