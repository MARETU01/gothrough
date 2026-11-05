package service

import (
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
		parts[i] = utils.SanitizeFilenameKeepUnicode(part, 200)
		if parts[i] == "" {
			return "", ErrPath
		}
	}
	return strings.Join(parts, "/"), nil
}

func (s *UploadService) prepareParent(name string) error {
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return err
	}
	defer root.Close()
	dir := filepath.Dir(filepath.FromSlash(name))
	if err := root.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建上传目录失败: %w", err)
	}
	// Publishing uses a hard link from the separate temporary directory.
	// Do not allow a pre-existing symlink or junction to redirect its parent.
	for dir != "." {
		info, err := root.Lstat(dir)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return ErrPath
		}
		dir = filepath.Dir(dir)
	}
	return nil
}
