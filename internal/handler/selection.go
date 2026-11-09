package handler

import (
	"errors"
	"mime"
	"net/http"
	"os"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *FileHandler) DeleteSelection(c *gin.Context) {
	var request struct {
		Entries []service.SelectionEntry `json:"entries"`
	}
	if err := BindLimitedJSON(c, &request, 512*1024); err != nil {
		invalidJSON(c, err, "INVALID_FILE_SELECTION", "请选择有效的文件或文件夹")
		return
	}
	results, err := h.files.DeleteSelection(c.Request.Context(), request.Entries)
	if err != nil {
		respondError(c, err, 400, "INVALID_FILE_SELECTION", "请选择有效的文件或文件夹")
		return
	}
	type result struct {
		Path    string `json:"path"`
		Deleted bool   `json:"deleted"`
		Code    string `json:"code,omitempty"`
		Error   string `json:"error,omitempty"`
	}
	response := make([]result, len(results))
	deleted := 0
	for i, entry := range results {
		response[i] = result{Path: entry.Path, Deleted: entry.Err == nil}
		if entry.Err == nil {
			deleted++
			continue
		}
		_ = c.Error(entry.Err)
		_, response[i].Code, response[i].Error = selectionErrorDetails(entry.Err)
	}
	logging.FromContext(c.Request.Context()).Info("批量删除已处理", "event", "files.batch_deleted", "requested", len(results), "deleted", deleted)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"results": response})
}

func selectionErrorDetails(err error) (int, string, string) {
	switch {
	case errors.Is(err, service.ErrSelection):
		return 400, "INVALID_FILE_SELECTION", "请选择有效的文件或文件夹"
	case errors.Is(err, service.ErrFolderBusy):
		return 409, "FOLDER_BUSY", service.ErrFolderBusy.Error()
	case errors.Is(err, service.ErrSelectionChanged):
		return 409, "SELECTION_CHANGED", service.ErrSelectionChanged.Error()
	case errors.Is(err, os.ErrNotExist), errors.Is(err, service.ErrFileInaccessible):
		return 404, "FILE_INACCESSIBLE", "文件不存在或无法访问"
	}
	return storageErrorDetails(err, "FILE_DELETE_FAILED", "删除文件失败，请稍后重试")
}

func (h *FileHandler) DownloadSelection(c *gin.Context) {
	if len(c.Request.URL.RawQuery) > 64*1024 {
		respondError(c, nil, 400, "INVALID_FILE_SELECTION", "请选择有效的文件或文件夹")
		return
	}
	archive, err := h.files.OpenSelection(c.QueryArray("path"))
	if err != nil {
		status, code, message := selectionErrorDetails(err)
		if status == 500 {
			code, message = "FILE_READ_FAILED", "读取文件失败，请稍后重试"
		}
		respondError(c, err, status, code, message)
		return
	}
	defer archive.Close()
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": "files.zip"}))
	if err := archive.WriteZIP(c.Request.Context(), c.Writer); err != nil {
		logging.FromContext(c.Request.Context()).Error("ZIP download interrupted", "event", "files.batch_download_failed", "error", err)
		panic(http.ErrAbortHandler)
	}
}
