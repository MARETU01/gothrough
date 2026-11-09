package handler

import (
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"uuid"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/service"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	files   *service.FileService
	streams chan struct{}
}

func NewUploadHandler(files *service.FileService) *UploadHandler {
	return &UploadHandler{files: files, streams: make(chan struct{}, service.MaxConcurrentChunks)}
}

// 初始化分块上传
func (h *UploadHandler) UploadInit(c *gin.Context) {
	var req model.UploadInitRequest
	if err := bindLimitedJSON(c, &req, 64*1024, jsonCompatible); err != nil {
		invalidJSON(c, err, "INVALID_UPLOAD", "无效的上传请求")
		return
	}
	if req.Filename == "" || req.TotalSize == nil || *req.TotalSize < 0 || *req.TotalSize > service.MaxUploadSize {
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_UPLOAD", "error": "缺少 filename 或 total_size"})
		return
	}

	session, err := h.files.InitSession(model.InitRequest{
		Filename: req.Filename, RelativePath: req.RelativePath, TotalSize: *req.TotalSize,
	})
	if err != nil {
		uploadError(c, err)
		return
	}
	withUploadSession(c, session.SessionID)
	logging.FromContext(c.Request.Context()).Info("上传会话已创建", "event", "upload.started", "size_bytes", session.TotalSize, "total_chunks", session.TotalChunks)

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
		uploadError(c, service.ErrBusy)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.ChunkSize+1024*1024)
	if strings.HasPrefix(c.GetHeader("Content-Type"), "application/octet-stream") {
		if c.Request.ContentLength > service.ChunkSize {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "CHUNK_TOO_LARGE", "error": "分块超过大小限制"})
			return
		}
		index, err := strconv.Atoi(c.Query("chunk_index"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CHUNK_INDEX", "error": "无效的 chunk_index"})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_CHUNK_INDEX", "error": "无效的 chunk_index"})
		return
	}

	chunkFile, err := c.FormFile("chunk")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": "MISSING_CHUNK_DATA", "error": "无分块数据"})
		return
	}

	file, err := chunkFile.Open()
	if err != nil {
		respondError(c, err, http.StatusInternalServerError, "CHUNK_READ_FAILED", "读取分块失败，请稍后重试")
		return
	}
	defer file.Close()
	h.writeChunk(c, sessionID, chunkIndex, file)
}

func (h *UploadHandler) writeChunk(c *gin.Context, id string, index int, body io.Reader) {
	withUploadSession(c, id)
	logging.WithRequestFields(c, "chunk_index", index)
	count, err := h.files.WriteChunk(id, index, body)
	if err != nil {
		uploadError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session_id": id, "chunk_index": index, "received": count})
}

// 查询上传进度
func (h *UploadHandler) UploadStatus(c *gin.Context) {
	sessionID := c.Param("session_id")
	withUploadSession(c, sessionID)
	state, err := h.files.LookupUpload(sessionID)
	if err != nil {
		uploadError(c, err)
		return
	}
	if state.Completion != nil {
		completedResponse(c, *state.Completion)
		return
	}
	session := state.Session

	progress := 100.0
	if session.TotalChunks > 0 {
		progress = float64(session.ReceivedCount()) / float64(session.TotalChunks) * 100
	}
	sortedChunks := session.ReceivedChunks

	c.JSON(http.StatusOK, gin.H{
		"status":            "uploading",
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
	sessionID, ok := sessionIDFromRequest(c)
	if !ok {
		return
	}
	withUploadSession(c, sessionID)
	state, err := h.files.LookupUpload(sessionID)
	if err != nil {
		uploadError(c, err)
		return
	}
	if state.Completion != nil {
		completedResponse(c, *state.Completion)
		return
	}
	session := state.Session

	finalFilename, actualSize, err := h.files.CompleteSession(sessionID)
	if err != nil {
		_ = c.Error(err)
		if errors.Is(err, service.ErrMissingChunks) {
			missing := []int{}
			for i := 0; i < session.TotalChunks; i++ {
				if !session.HasChunk(i) {
					missing = append(missing, i)
				}
			}
			c.JSON(http.StatusBadRequest, gin.H{
				"code":           "MISSING_CHUNKS",
				"error":          "缺少分块",
				"missing_chunks": missing,
				"total_chunks":   session.TotalChunks,
				"received":       session.ReceivedCount(),
			})
			return
		}
		status, code, message := uploadErrorDetails(c, err)
		c.JSON(status, gin.H{
			"original_filename": session.OriginalFilename,
			"saved_filename":    session.FinalFilename,
			"status":            "failed",
			"message":           message,
			"code":              code,
			"error":             message,
		})
		return
	}

	if started, parseErr := time.Parse(time.RFC3339, session.CreatedAt); parseErr == nil {
		logging.WithRequestFields(c, "upload_elapsed_ms", max(0, time.Since(started).Milliseconds()))
	}
	logging.FromContext(c.Request.Context()).Info("文件上传已完成", "event", "upload.completed", "size_bytes", actualSize)
	completedResponse(c, model.UploadCompletion{SessionID: sessionID, OriginalFilename: session.OriginalFilename,
		SavedFilename: finalFilename, Size: actualSize})
}

func completedResponse(c *gin.Context, result model.UploadCompletion) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"session_id": result.SessionID, "original_filename": result.OriginalFilename,
		"saved_filename": result.SavedFilename, "size": result.Size, "status": "success", "message": "上传完成"})
}

// 取消上传
func (h *UploadHandler) UploadCancel(c *gin.Context) {
	sessionID, ok := sessionIDFromRequest(c)
	if !ok {
		return
	}
	withUploadSession(c, sessionID)

	if err := h.files.CancelSession(sessionID); err != nil {
		uploadError(c, err)
		return
	}
	logging.FromContext(c.Request.Context()).Info("上传会话已取消", "event", "upload.cancelled")

	c.JSON(http.StatusOK, gin.H{
		"status":     "cancelled",
		"session_id": sessionID,
	})
}

func sessionIDFromRequest(c *gin.Context) (string, bool) {
	var req model.SessionRequest
	if err := bindLimitedJSON(c, &req, 1024, jsonCompatible); err != nil {
		invalidJSON(c, err, "MISSING_SESSION", "缺少 session_id")
		return "", false
	}
	parsed, err := uuid.Parse(req.SessionID)
	if err != nil || parsed.String() != req.SessionID {
		c.JSON(http.StatusBadRequest, gin.H{"code": "MISSING_SESSION", "error": "缺少 session_id"})
		return "", false
	}
	return req.SessionID, true
}

func uploadError(c *gin.Context, err error) {
	status, code, message := uploadErrorDetails(c, err)
	respondError(c, err, status, code, message)
}

func withUploadSession(c *gin.Context, id string) {
	// Only normalized UUIDs become log fields; arbitrary request values are omitted.
	if parsed, err := uuid.Parse(id); err == nil {
		logging.WithRequestFields(c, "session_id", parsed.String())
	}
}

func uploadErrorDetails(c *gin.Context, err error) (int, string, string) {
	switch {
	case errors.Is(err, service.ErrSession):
		return http.StatusNotFound, "INVALID_SESSION", service.ErrSession.Error()
	case errors.Is(err, service.ErrChunk):
		return http.StatusBadRequest, "INVALID_CHUNK", service.ErrChunk.Error()
	case errors.Is(err, service.ErrPath):
		return http.StatusBadRequest, "INVALID_PATH", service.ErrPath.Error()
	case errors.Is(err, service.ErrPathConflict):
		return http.StatusConflict, "PATH_CONFLICT", service.ErrPathConflict.Error()
	case errors.Is(err, service.ErrBusy):
		return busyErrorDetails(c)
	case requestTooLarge(err):
		return http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "请求体过大"
	}
	return storageErrorDetails(err, "UPLOAD_FAILED", "上传失败，请稍后重试")
}
