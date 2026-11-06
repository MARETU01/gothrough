package config

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/MARETU01/gothrough/internal/utils"
)

const (
	MaxMultipartMemory        = 50 * 1024 * 1024 // multipart 解析的内存阈值，不是请求体大小限制
	ChunkSize                 = 8 * 1024 * 1024  // 默认分块大小 8MiB
	MaxUploadSize       int64 = 1 << 40          // 单文件上限 1TiB
	MaxConcurrentChunks       = 16
	MaxUploadSessions         = 1024
)

var (
	UploadFolder    string
	TempFolder      string
	ClipboardFolder string
	BaseDir         string
)

func Init(dataDir string) error {
	if strings.TrimSpace(dataDir) == "" {
		return fmt.Errorf("数据目录不能为空")
	}
	base, err := filepath.Abs(dataDir)
	if err != nil {
		return fmt.Errorf("解析数据目录: %w", err)
	}
	upload := filepath.Join(base, "uploads")
	temp := filepath.Join(base, "temp_uploads")
	clipboard := filepath.Join(base, "clipboard")
	for _, dir := range []struct {
		path string
		mode os.FileMode
	}{{upload, 0755}, {temp, 0700}, {clipboard, 0700}} {
		if err := os.MkdirAll(dir.path, dir.mode); err != nil {
			return utils.StorageError("创建数据目录失败", err)
		}
	}
	// Validate storage before removing any leftover upload sessions.
	if err := utils.CheckStorage(temp, upload); err != nil {
		return err
	}
	if err := cleanupTempUploads(temp); err != nil {
		return err
	}
	BaseDir, UploadFolder, TempFolder, ClipboardFolder = base, upload, temp, clipboard
	slog.Info("数据目录已初始化", "event", "storage.ready", "data_dir", BaseDir, "upload_dir", UploadFolder, "temp_dir", TempFolder, "clipboard_dir", ClipboardFolder)
	return nil
}

func cleanupTempUploads(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return utils.StorageError("读取临时上传目录失败", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return utils.StorageError("清理残留上传失败", err)
		}
		slog.Info("残留上传会话已清理", "event", "upload.startup_cleanup", "session_id", entry.Name())
	}
	return nil
}
