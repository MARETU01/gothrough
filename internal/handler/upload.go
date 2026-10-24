package handler

import (
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/MARETU01/gothrough/internal/utils"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	uploadService *service.UploadService
	streams       chan struct{}
}

func NewUploadHandler(us *service.UploadService) *UploadHandler {
	return &UploadHandler{uploadService: us, streams: make(chan struct{}, 16)}
}

// 初始化分块上传
func (h *UploadHandler) UploadInit(c *gin.Context) {
	var req model.InitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Filename == "" || req.TotalSize < 0 || req.TotalSize > 1<<40 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 filename 或 total_size"})
		return
	}

	session, err := h.uploadService.InitSession(req)
	if err != nil {
		if errors.Is(err, service.ErrBusy) {
			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id":       session.SessionID,
		"chunk_size":       session.ChunkSize,
		"total_chunks":     session.TotalChunks,
		"final_filename":   session.FinalFilename,
		"upload_transport": "raw",
	})
}

// 上传单个分块
func (h *UploadHandler) UploadChunk(c *gin.Context) {
	// Bound compatibility parsing as well as direct streams; multipart allocates
	// memory before reaching the service's independent disk-write limiter.
	select {
	case h.streams <- struct{}{}:
		defer func() { <-h.streams }()
	default:
		c.Header("Retry-After", "1")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": service.ErrBusy.Error()})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, config.ChunkSize+1024*1024)
	if strings.HasPrefix(c.GetHeader("Content-Type"), "application/octet-stream") {
		if c.Request.ContentLength > config.ChunkSize {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "分块超过大小限制"})
			return
		}
		index, err := strconv.Atoi(c.Query("chunk_index"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 chunk_index"})
			return
		}
		h.writeChunk(c, c.Query("session_id"), index, c.Request.Body)
		return
	}
	// Compatibility for existing multipart clients; new clients stream raw bodies.
	sessionID := c.PostForm("session_id")
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	chunkIndexStr := c.PostForm("chunk_index")

	chunkIndex, err := strconv.Atoi(chunkIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 chunk_index"})
		return
	}

	chunkFile, err := c.FormFile("chunk")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无分块数据"})
		return
	}

	file, err := chunkFile.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取分块失败"})
		return
	}
	defer file.Close()
	h.writeChunk(c, sessionID, chunkIndex, file)
}

func (h *UploadHandler) writeChunk(c *gin.Context, id string, index int, body io.Reader) {
	count, err := h.uploadService.WriteChunk(id, index, body)
	if err != nil {
		status := http.StatusInternalServerError
		var tooLarge *http.MaxBytesError
		switch {
		case errors.Is(err, service.ErrSession):
			status = http.StatusNotFound
		case errors.Is(err, service.ErrChunk):
			status = http.StatusBadRequest
		case errors.Is(err, service.ErrBusy):
			status = http.StatusTooManyRequests
			c.Header("Retry-After", "1")
		case errors.As(err, &tooLarge):
			status = http.StatusRequestEntityTooLarge
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": id, "chunk_index": index, "received": count})
}

// 查询上传进度
func (h *UploadHandler) UploadStatus(c *gin.Context) {
	sessionID := c.Param("session_id")

	session, err := h.uploadService.GetSession(sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	progress := 100.0
	if session.TotalChunks > 0 {
		progress = float64(session.ReceivedCount()) / float64(session.TotalChunks) * 100
	}
	sortedChunks := session.ReceivedChunks

	c.JSON(http.StatusOK, gin.H{
		"session_id":        sessionID,
		"final_filename":    session.FinalFilename,
		"original_filename": session.OriginalFilename,
		"total_size":        session.TotalSize,
		"chunk_size":        session.ChunkSize,
		"total_chunks":      session.TotalChunks,
		"received_chunks":   sortedChunks,
		"progress":          math.Round(progress*100) / 100,
	})
}

// 完成上传
func (h *UploadHandler) UploadComplete(c *gin.Context) {
	var req model.CompleteRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 session_id"})
		return
	}

	session, err := h.uploadService.GetSession(req.SessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	finalFilename, actualSize, err := h.uploadService.CompleteSession(req.SessionID)
	if err != nil {
		if strings.Contains(err.Error(), "缺少分块") {
			missing := []int{}
			for i := 0; i < session.TotalChunks; i++ {
				if !session.HasChunk(i) {
					missing = append(missing, i)
				}
			}
			c.JSON(http.StatusBadRequest, gin.H{
				"error":          "缺少分块",
				"missing_chunks": missing,
				"total_chunks":   session.TotalChunks,
				"received":       session.ReceivedCount(),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"original_filename": session.OriginalFilename,
			"saved_filename":    session.FinalFilename,
			"status":            "failed",
			"message":           err.Error(),
			"error":             err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"original_filename": session.OriginalFilename,
		"saved_filename":    finalFilename,
		"size":              actualSize,
		"status":            "success",
		"message":           "上传完成",
	})
}

// 取消上传
func (h *UploadHandler) UploadCancel(c *gin.Context) {
	var req model.CancelRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 session_id"})
		return
	}

	if err := h.uploadService.CancelSession(req.SessionID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":     "cancelled",
		"session_id": req.SessionID,
	})
}

// 已上传文件列表
func (h *UploadHandler) ListUploads(c *gin.Context) {
	entries, totalSize, err := h.uploadService.ListFiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	diskUsage, err := utils.GetDiskUsage(config.UploadFolder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"files":              entries,
		"total_size":         totalSize,
		"total_size_display": utils.FormatFileSize(totalSize),
		"disk_total":         diskUsage.Total,
		"disk_total_display": utils.FormatFileSize(int64(diskUsage.Total)),
		"disk_used":          diskUsage.Used,
		"disk_used_display":  utils.FormatFileSize(int64(diskUsage.Used)),
		"disk_free":          diskUsage.Free,
		"disk_free_display":  utils.FormatFileSize(int64(diskUsage.Free)),
		"disk_pct":           math.Round(diskUsage.UsedPercent*10) / 10,
		"disk_pct_warning":   diskUsage.UsedPercent > 85,
		"has_files":          len(entries) > 0,
	})
}

// 文件下载
func (h *UploadHandler) DownloadUpload(c *gin.Context) {
	filename := c.Param("filename")
	filename = strings.TrimPrefix(filename, "/")
	rel := utils.SafeUploadRelpath(filename, config.UploadFolder)
	if rel == "" {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	fullPath := filepath.Join(config.UploadFolder, rel)

	rootReal, _ := filepath.Abs(config.UploadFolder)
	fullReal, _ := filepath.Abs(fullPath)
	if fullReal != rootReal && !strings.HasPrefix(fullReal, rootReal+string(os.PathSeparator)) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(rel)))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Accept-Ranges", "bytes")

	http.ServeFile(c.Writer, c.Request, fullPath)
}

// 文件删除
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	filename := c.Param("filename")
	filename = strings.TrimPrefix(filename, "/")

	rel := utils.SafeUploadRelpath(filename, config.UploadFolder)
	if rel == "" {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	fullPath := filepath.Join(config.UploadFolder, rel)

	rootReal, _ := filepath.Abs(config.UploadFolder)
	fullReal, _ := filepath.Abs(fullPath)
	if fullReal != rootReal && !strings.HasPrefix(fullReal, rootReal+string(os.PathSeparator)) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	if err := h.uploadService.DeleteFile(filename); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "deleted",
		"filename": rel,
	})
}

// 磁盘信息 API
func (h *UploadHandler) DiskInfo(c *gin.Context) {
	diskUsage, err := utils.GetDiskUsage(config.UploadFolder)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var totalSize int64
	var fileCount int

	files, err := os.ReadDir(config.UploadFolder)
	if err == nil {
		for _, f := range files {
			if !f.IsDir() {
				info, e := f.Info()
				if e == nil {
					totalSize += info.Size()
					fileCount++
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"disk_total":           diskUsage.Total,
		"disk_used":            diskUsage.Used,
		"disk_free":            diskUsage.Free,
		"uploads_size":         totalSize,
		"uploads_count":        fileCount,
		"disk_total_display":   utils.FormatFileSize(int64(diskUsage.Total)),
		"disk_used_display":    utils.FormatFileSize(int64(diskUsage.Used)),
		"disk_free_display":    utils.FormatFileSize(int64(diskUsage.Free)),
		"uploads_size_display": utils.FormatFileSize(totalSize),
	})
}
