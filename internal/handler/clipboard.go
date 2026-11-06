package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

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
	c.Header("Cache-Control", "no-store")
	body, etag := h.service.Snapshot()
	c.Header("ETag", etag)
	// GET uses weak comparison. Our validators contain only hexadecimal digits,
	// so splitting a client's list cannot split a matching opaque tag.
	for _, value := range c.Request.Header.Values("If-None-Match") {
		for _, candidate := range strings.Split(value, ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "*" || strings.TrimPrefix(candidate, "W/") == etag {
				c.Status(http.StatusNotModified)
				return
			}
		}
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(body))
}

func (h *ClipboardHandler) Create(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.ClipboardMaxBytes*6+1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	var req model.ClipboardRequest
	err := decoder.Decode(&req)
	if err == nil {
		var extra any
		if nextErr := decoder.Decode(&extra); !errors.Is(nextErr, io.EOF) {
			if nextErr != nil {
				err = nextErr
			} else {
				err = errors.New("只允许一个 JSON 对象")
			}
		}
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "REQUEST_TOO_LARGE", "error": "请求体过大"})
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_TEXT_REQUEST", "error": "无效的文本请求"})
		}
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
