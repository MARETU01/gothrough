package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MARETU01/gothrough/internal/utils"
)

// Upload paths are literal names, never URL-decoded. Reject traversal before
// sanitizing each component, keeping directory separators under server control.
func sanitizeUploadPath(name string) (string, error) {
	name = strings.ReplaceAll(name, `\`, "/")
	parts := strings.Split(name, "/")
	if len(name) > 4096 || len(parts) > 32 {
		return "", ErrPath
	}
	for i, part := range parts {
		if part == "" || part == "." || part == ".." || strings.Contains(part, ":") {
			return "", ErrPath
		}
		parts[i] = utils.SanitizeFilenameKeepUnicode(part, utils.MaxFilenameBytes)
		if parts[i] == "" {
			return "", ErrPath
		}
	}
	return strings.Join(parts, "/"), nil
}

func (s *UploadService) prepareParent(name string) error {
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return utils.StorageError("打开上传目录失败", err)
	}
	defer root.Close()
	dir := "."
	parent := filepath.ToSlash(filepath.Dir(filepath.FromSlash(name)))
	if parent == "." {
		return nil
	}
	// Check each ancestor before creating children, rejecting symlinks and files
	// before any upload data is accepted. Re-check at publication for local changes.
	for _, part := range strings.Split(parent, "/") {
		dir = filepath.Join(dir, part)
		info, err := root.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) {
			if err := root.Mkdir(dir, 0755); err != nil && !errors.Is(err, os.ErrExist) {
				return utils.StorageError("创建上传父目录失败", err)
			}
			info, err = root.Lstat(dir)
		}
		if err != nil {
			return utils.StorageError("检查上传父目录失败", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return ErrPath
		}
		if !info.IsDir() {
			return fmt.Errorf("%w: %s 是文件，不能作为目录", ErrPathConflict, filepath.ToSlash(dir))
		}
	}
	return nil
}
