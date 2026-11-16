package handler

import (
	"errors"
	"net/http"
	"os"
	"uuid"

	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *FileHandler) Spreadsheet(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	rel := h.uploadRelativePath(c)
	if rel == "" {
		return
	}
	preview, err := h.files.PreviewSpreadsheet(c.Request.Context(), rel)
	if err != nil {
		spreadsheetError(c, err)
		return
	}
	c.JSON(http.StatusOK, preview)
}

func (h *FileHandler) EditSpreadsheet(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	rel := h.uploadRelativePath(c)
	if rel == "" {
		return
	}
	var req struct {
		OperationID string                      `json:"operation_id"`
		Version     string                      `json:"version"`
		Changes     []service.SpreadsheetChange `json:"changes"`
	}
	if err := BindLimitedJSON(c, &req, 512*1024); err != nil {
		invalidJSON(c, err, "INVALID_SPREADSHEET_CHANGE", "单元格修改无效")
		return
	}
	if req.Version == "" {
		respondError(c, nil, 428, "TEXT_VERSION_REQUIRED", "请重新加载文件后再保存")
		return
	}
	if req.OperationID != "" {
		result, err := h.files.SaveSpreadsheetOperation(c.Request.Context(), rel, req.Version, req.Changes, req.OperationID)
		if err != nil {
			spreadsheetError(c, err)
			return
		}
		if result.Preview != nil {
			logging.FromContext(c.Request.Context()).Info("工作簿已保存", "event", "file.edited", "relative_path", rel)
		}
		c.JSON(http.StatusOK, result)
		return
	}
	preview, err := h.files.SaveSpreadsheet(c.Request.Context(), rel, req.Version, req.Changes)
	if err != nil {
		spreadsheetError(c, err)
		return
	}
	logging.FromContext(c.Request.Context()).Info("工作簿已保存", "event", "file.edited", "relative_path", rel)
	c.JSON(http.StatusOK, preview)
}

func (h *FileHandler) SpreadsheetSaveStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := c.Param("operation_id")
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id || h.files.RelativePath(c.Query("filename")) == "" {
		spreadsheetError(c, service.ErrSpreadsheetOperation)
		return
	}
	c.JSON(http.StatusOK, h.files.SpreadsheetSaveStatus(c.Query("filename"), id))
}

func spreadsheetError(c *gin.Context, err error) {
	status, code, message := 500, "SPREADSHEET_FAILED", "工作簿操作失败，请稍后重试"
	switch {
	case errors.Is(err, service.ErrSpreadsheetOperation):
		status, code, message = 409, "SPREADSHEET_OPERATION_CONFLICT", "保存操作标识无效或已用于其他修改，请保留草稿后重新加载"
	case errors.Is(err, service.ErrSpreadsheet):
		status, code, message = 415, "SPREADSHEET_UNSUPPORTED", "仅支持有效且未加密的 XLSX 工作簿"
	case errors.Is(err, service.ErrSpreadsheetLimit):
		status, code, message = 413, "SPREADSHEET_LIMIT", "工作簿超出预览或编辑限制，请下载查看"
	case errors.Is(err, service.ErrSpreadsheetChange):
		status, code, message = 400, "INVALID_SPREADSHEET_CHANGE", "单元格修改无效，或目标单元格只读"
	case errors.Is(err, service.ErrTextConflict):
		status, code, message = 409, "TEXT_CONFLICT", "文件已被修改，请重新加载后再编辑"
	case errors.Is(err, service.ErrPathDeleting):
		status, code, message = 409, "PATH_BUSY", "文件夹正在删除，请稍后重试"
	case errors.Is(err, service.ErrBusy):
		status, code, message = busyErrorDetails(c)
	case errors.Is(err, os.ErrNotExist), errors.Is(err, service.ErrFileInaccessible):
		status, code, message = 404, "FILE_INACCESSIBLE", "文件不存在或无法访问"
	default:
		status, code, message = storageErrorDetails(err, code, message)
	}
	respondError(c, err, status, code, message)
}
