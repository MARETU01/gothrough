package utils

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

var (
	ErrStorageFull         = errors.New("磁盘可用空间或存储配额不足，请清理文件后重试")
	ErrStoragePermission   = errors.New("存储目录无写入权限，请检查服务账号权限")
	ErrStorageReadOnly     = errors.New("存储目录所在文件系统为只读")
	ErrHardlinkUnsupported = errors.New("临时目录和上传目录必须位于同一文件系统，且支持硬链接")
)

// StorageError adds an actionable reason while preserving the OS error chain.
func StorageError(operation string, err error) error {
	if err == nil {
		return nil
	}
	if reason := storageErrorReason(err); reason != nil {
		return fmt.Errorf("%s: %w: %w", operation, reason, err)
	}
	if errors.Is(err, os.ErrPermission) {
		return fmt.Errorf("%s: %w: %w", operation, ErrStoragePermission, err)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

// CheckStorage verifies writes in both locations and the hard-link operation
// used to publish uploads. Probe files never overwrite existing data.
func CheckStorage(tempDir, uploadDir string) (err error) {
	probe, err := os.CreateTemp(tempDir, ".gothrough-check-*")
	if err != nil {
		return StorageError("检查临时目录写入能力失败", err)
	}
	defer func() {
		err = errors.Join(err, StorageError("清理存储检查文件失败", os.Remove(probe.Name())))
	}()
	if err := probe.Close(); err != nil {
		return StorageError("关闭存储检查文件失败", err)
	}
	target := filepath.Join(uploadDir, filepath.Base(probe.Name())+".link")
	if err := os.Link(probe.Name(), target); err != nil {
		return StorageError("检查上传目录写入及硬链接能力失败", err)
	}
	defer func() {
		err = errors.Join(err, StorageError("清理上传目录检查文件失败", os.Remove(target)))
	}()
	return nil
}
