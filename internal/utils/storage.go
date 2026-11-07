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
	root, err := os.OpenRoot(uploadDir)
	if err != nil {
		return StorageError("打开上传目录失败", err)
	}
	defer root.Close()
	return CheckStorageInRoot(tempDir, root, ".")
}

// CheckStorageInRoot keeps nested upload parents confined during the probe too.
func CheckStorageInRoot(tempDir string, root *os.Root, parent string) (err error) {
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
	directory, err := root.Open(parent)
	if err != nil {
		return StorageError("打开上传父目录失败", err)
	}
	defer directory.Close()
	name := filepath.Base(probe.Name()) + ".link"
	if err := LinkInto(probe.Name(), directory, name); err != nil {
		return StorageError("检查上传目录写入及硬链接能力失败", err)
	}
	defer func() {
		err = errors.Join(err, StorageError("清理上传目录检查文件失败", root.Remove(filepath.Join(parent, name))))
	}()
	return nil
}
