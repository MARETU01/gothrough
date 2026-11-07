package handler

import (
	"errors"
	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

func (h *ClipboardHandler) ImageConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, h.service.ImageSettings())
}

func (h *ClipboardHandler) CreateImage(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !h.service.ImageSettings().Enabled {
		respondError(c, service.ErrClipboardImageDisabled, http.StatusForbidden, "IMAGE_DISABLED", service.ErrClipboardImageDisabled.Error())
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, int64(h.service.ImageSettings().MaxSizeMB)*1024*1024+65536)
	// Stream the multipart part directly rather than buffering every concurrent
	// request in Gin's multipart parser before the decoder admission limit.
	r, err := c.Request.MultipartReader()
	if err != nil {
		respondError(c, err, http.StatusBadRequest, "INVALID_IMAGE_REQUEST", "无效的图片请求")
		return
	}
	part, err := r.NextPart()
	if err != nil {
		if requestTooLarge(err) {
			clipboardImageFailure(c, err)
		} else {
			respondError(c, err, http.StatusBadRequest, "INVALID_IMAGE_SELECTION", "请选择一张有效图片")
		}
		return
	}
	defer part.Close()
	if part.FormName() != "image" || part.FileName() == "" {
		respondError(c, nil, http.StatusBadRequest, "MISSING_IMAGE", "请选择一张图片")
		return
	}
	entry, err := h.service.CreateImage(part)
	if err != nil {
		clipboardImageFailure(c, err)
		return
	}
	logging.FromContext(c.Request.Context()).Info("剪贴板图片已发布", "event", "clipboard.image_created", "entry_id", entry.ID, "size_bytes", entry.Image.Size)
	c.JSON(http.StatusCreated, entry)
}

func (h *ClipboardHandler) Image(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	if c.Query("thumbnail") == "1" && c.Query("download") != "1" {
		data, err := h.service.Thumbnail(c.Param("id"))
		if errors.Is(err, service.ErrClipboardNotFound) {
			respondError(c, err, http.StatusNotFound, "CLIPBOARD_NOT_FOUND", service.ErrClipboardNotFound.Error())
		} else if errors.Is(err, service.ErrBusy) {
			respondBusy(c, err)
		} else if err != nil {
			respondError(c, err, http.StatusInternalServerError, "IMAGE_READ_FAILED", "读取剪贴板图片失败，请稍后重试")
		} else {
			c.Data(http.StatusOK, "image/png", data)
		}
		return
	}
	f, err := h.service.OpenImage(c.Param("id"))
	if errors.Is(err, service.ErrClipboardNotFound) {
		respondError(c, err, http.StatusNotFound, "CLIPBOARD_NOT_FOUND", service.ErrClipboardNotFound.Error())
		return
	}
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "IMAGE_READ_FAILED", "读取剪贴板图片失败，请稍后重试")
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "IMAGE_READ_FAILED", "读取剪贴板图片失败，请稍后重试")
		return
	}
	c.Header("Content-Type", "image/png")
	if c.Query("download") == "1" {
		c.Header("Content-Disposition", `attachment; filename="clipboard.png"`)
	}
	http.ServeContent(c.Writer, c.Request, "clipboard.png", stat.ModTime(), f)
}

func clipboardImageFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrClipboardImageSize), requestTooLarge(err):
		respondError(c, err, http.StatusRequestEntityTooLarge, "IMAGE_TOO_LARGE", service.ErrClipboardImageSize.Error())
	case errors.Is(err, service.ErrClipboardImageQuota):
		respondError(c, err, http.StatusConflict, "IMAGE_QUOTA", service.ErrClipboardImageQuota.Error())
	case errors.Is(err, service.ErrClipboardImage):
		respondError(c, err, http.StatusBadRequest, "INVALID_IMAGE", service.ErrClipboardImage.Error())
	case errors.Is(err, service.ErrBusy):
		respondBusy(c, err)
	default:
		respondError(c, err, http.StatusInternalServerError, "IMAGE_PUBLISH_FAILED", "图片发布失败，请稍后重试")
	}
}
