package service

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
)

// writeClipboardFile replaces a private clipboard file only after a successful,
// synced write. Metadata commits and image rollback belong to the caller. Text
// editing deliberately keeps its separate os.Root-based publication path.
func writeClipboardFile(target, pattern string, write func(io.Writer) error) error {
	file, err := os.CreateTemp(filepath.Dir(target), pattern)
	if err != nil {
		return err
	}
	defer func() {
		if err := os.Remove(file.Name()); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Warn("清理剪贴板临时文件失败", "event", "clipboard.cleanup_failed", "error", err)
		}
	}()
	defer file.Close()
	if err := write(file); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), target)
}
