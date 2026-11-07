package handler

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

// 已上传文件列表
func (h *UploadHandler) ListUploads(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	// Keep the original combined response for existing clients. The compact view
	// is independently versioned and does not perform a disk-space query.
	if c.Query("view") == "list" {
		body, etag, err := h.uploadService.FileListSnapshot()
		if err != nil {
			respondError(c, err, 500, "FILE_LIST_FAILED", "获取文件列表失败，请稍后重试")
			return
		}
		if respondNotModified(c, etag) {
			return
		}
		c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(body))
		return
	}
	storage, err := h.uploadService.StorageInfo()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "FILE_LIST_FAILED", "获取文件列表失败，请稍后重试")
		return
	}

	response := diskFields(storage.Disk)
	response["files"] = storage.Files
	response["total_size"] = storage.TotalSize
	response["total_size_display"] = utils.FormatFileSize(storage.TotalSize)
	response["has_files"] = len(storage.Files) > 0
	c.JSON(http.StatusOK, response)
}

// 文件下载
func (h *UploadHandler) DownloadUpload(c *gin.Context) {
	rel := h.uploadRelativePath(c)
	if rel == "" {
		return
	}

	file, info, err := h.uploadService.OpenFile(rel)
	if err != nil {
		if errors.Is(err, service.ErrFileInaccessible) {
			respondError(c, err, http.StatusNotFound, "FILE_INACCESSIBLE", "文件不存在或无法访问")
		} else {
			respondError(c, err, http.StatusInternalServerError, "FILE_READ_FAILED", "读取文件失败，请稍后重试")
		}
		return
	}
	defer file.Close()
	if c.Query("preview") != "" {
		servePreview(c, file, info)
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(rel)))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Accept-Ranges", "bytes")

	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
}

// 文件删除
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	rel := h.uploadRelativePath(c)
	if rel == "" {
		return
	}

	if err := h.uploadService.DeleteFile(rel); err != nil {
		if os.IsNotExist(err) {
			respondError(c, err, http.StatusNotFound, "FILE_NOT_FOUND", "文件不存在")
			return
		}
		respondError(c, err, http.StatusInternalServerError, "FILE_DELETE_FAILED", "删除文件失败，请稍后重试")
		return
	}

	logging.FromContext(c.Request.Context()).Info("文件已删除", "event", "file.deleted", "relative_path", rel)
	c.JSON(http.StatusOK, gin.H{
		"status":   "deleted",
		"filename": rel,
	})
}

// 磁盘信息 API
func (h *UploadHandler) DiskInfo(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	storage, err := h.uploadService.StorageInfo()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "DISK_INFO_FAILED", "获取磁盘信息失败，请稍后重试")
		return
	}

	response := diskFields(storage.Disk)
	response["uploads_size"] = storage.TotalSize
	response["uploads_count"] = len(storage.Files)
	response["uploads_size_display"] = utils.FormatFileSize(storage.TotalSize)
	c.JSON(http.StatusOK, response)
}

func (h *UploadHandler) uploadRelativePath(c *gin.Context) string {
	filename := strings.TrimPrefix(c.Param("filename"), "/")
	rel := h.uploadService.RelativePath(filename)
	if rel == "" {
		respondError(c, nil, http.StatusNotFound, "FILE_INACCESSIBLE", "文件不存在或无法访问")
	}
	return rel
}

func diskFields(usage utils.DiskUsage) gin.H {
	return gin.H{
		"disk_pct":           math.Round(usage.UsedPercent*10) / 10,
		"disk_pct_warning":   usage.UsedPercent > 85,
		"disk_total":         usage.Total,
		"disk_used":          usage.Used,
		"disk_free":          usage.Free,
		"disk_total_display": utils.FormatFileSize(int64(usage.Total)),
		"disk_used_display":  utils.FormatFileSize(int64(usage.Used)),
		"disk_free_display":  utils.FormatFileSize(int64(usage.Free)),
	}
}
