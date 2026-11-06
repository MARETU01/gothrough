package handler

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/gin-gonic/gin"
)

// 已上传文件列表
func (h *UploadHandler) ListUploads(c *gin.Context) {
	storage, err := h.uploadService.StorageInfo()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "获取文件列表失败，请稍后重试")
		return
	}

	response := diskFields(storage.Disk)
	response["files"] = storage.Files
	response["total_size"] = storage.TotalSize
	response["total_size_display"] = utils.FormatFileSize(storage.TotalSize)
	response["disk_pct"] = math.Round(storage.Disk.UsedPercent*10) / 10
	response["disk_pct_warning"] = storage.Disk.UsedPercent > 85
	response["has_files"] = len(storage.Files) > 0
	c.JSON(http.StatusOK, response)
}

// 文件下载
func (h *UploadHandler) DownloadUpload(c *gin.Context) {
	rel := uploadRelativePath(c)
	if rel == "" {
		return
	}

	root, err := os.OpenRoot(config.UploadFolder)
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "读取文件失败，请稍后重试")
		return
	}
	defer root.Close()
	file, err := root.Open(rel)
	if err != nil {
		respondError(c, err, http.StatusNotFound, "文件不存在或无法访问")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "读取文件失败，请稍后重试")
		return
	}
	if !info.Mode().IsRegular() {
		respondError(c, nil, http.StatusNotFound, "文件不存在或无法访问")
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(rel)))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Accept-Ranges", "bytes")

	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
}

// 文件删除
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	rel := uploadRelativePath(c)
	if rel == "" {
		return
	}

	if err := h.uploadService.DeleteFile(rel); err != nil {
		if os.IsNotExist(err) {
			respondError(c, err, http.StatusNotFound, "文件不存在")
			return
		}
		respondError(c, err, http.StatusInternalServerError, "删除文件失败，请稍后重试")
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
	storage, err := h.uploadService.StorageInfo()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "获取磁盘信息失败，请稍后重试")
		return
	}

	response := diskFields(storage.Disk)
	response["uploads_size"] = storage.TotalSize
	response["uploads_count"] = len(storage.Files)
	response["uploads_size_display"] = utils.FormatFileSize(storage.TotalSize)
	c.JSON(http.StatusOK, response)
}

func uploadRelativePath(c *gin.Context) string {
	filename := strings.TrimPrefix(c.Param("filename"), "/")
	rel := utils.SafeUploadRelpath(filename, config.UploadFolder)
	if rel == "" {
		respondError(c, nil, http.StatusNotFound, "文件不存在或无法访问")
	}
	return rel
}

func diskFields(usage utils.DiskUsage) gin.H {
	return gin.H{
		"disk_total":         usage.Total,
		"disk_used":          usage.Used,
		"disk_free":          usage.Free,
		"disk_total_display": utils.FormatFileSize(int64(usage.Total)),
		"disk_used_display":  utils.FormatFileSize(int64(usage.Used)),
		"disk_free_display":  utils.FormatFileSize(int64(usage.Free)),
	}
}
