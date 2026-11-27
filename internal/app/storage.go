package app

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/MARETU01/gothrough/internal/utils"
)

// StoragePaths belongs to one application instance, never to process globals.
type StoragePaths struct {
	BaseDir      string
	UploadDir    string
	TempDir      string
	ClipboardDir string
	lock         *os.File
}

var ErrStorageInUse = errors.New("数据目录已被另一个 GoThrough 进程使用")

// Close releases the directory lock after the application has stopped using it.
func (p StoragePaths) Close() error { return p.lock.Close() }

// PrepareStorage performs startup-only filesystem work after config validation.
func PrepareStorage(dataDir string) (StoragePaths, error) {
	if strings.TrimSpace(dataDir) == "" {
		return StoragePaths{}, fmt.Errorf("数据目录不能为空")
	}
	base, err := filepath.Abs(dataDir)
	if err != nil {
		return StoragePaths{}, fmt.Errorf("解析数据目录: %w", err)
	}
	if err := os.MkdirAll(base, 0755); err != nil {
		return StoragePaths{}, utils.StorageError("创建数据目录失败", err)
	}
	lock, err := os.OpenFile(filepath.Join(base, ".gothrough.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return StoragePaths{}, utils.StorageError("打开数据目录锁失败", err)
	}
	ready := false
	defer func() {
		if !ready {
			_ = lock.Close()
		}
	}()
	// Keep the lock file in place. Closing the handle releases the OS lock.
	if err := lockStorage(lock); err != nil {
		return StoragePaths{}, fmt.Errorf("锁定数据目录 %q: %w", base, err)
	}
	upload := filepath.Join(base, "uploads")
	temp := filepath.Join(base, "temp_uploads")
	clipboard := filepath.Join(base, "clipboard")
	for _, dir := range []struct {
		path string
		mode os.FileMode
	}{{upload, 0755}, {temp, 0700}} {
		if err := os.MkdirAll(dir.path, dir.mode); err != nil {
			return StoragePaths{}, utils.StorageError("创建数据目录失败", err)
		}
	}
	// Validate storage before removing any leftover upload sessions.
	if err := utils.CheckStorage(temp, upload); err != nil {
		return StoragePaths{}, err
	}
	if err := cleanupTempUploads(temp); err != nil {
		return StoragePaths{}, err
	}
	paths := StoragePaths{BaseDir: base, UploadDir: upload, TempDir: temp, ClipboardDir: clipboard, lock: lock}
	slog.Info("数据目录已初始化", "event", "storage.ready", "data_dir", base, "upload_dir", upload, "temp_dir", temp, "clipboard_dir", clipboard)
	ready = true
	return paths, nil
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
