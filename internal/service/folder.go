package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/MARETU01/gothrough/internal/utils"
)

func directoryKey(path string) string {
	key := filepath.ToSlash(path)
	if runtime.GOOS == "windows" {
		return strings.ToLower(key)
	}
	return key
}

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

func (s *FileService) prepareParent(name string) error {
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
		created := false
		if errors.Is(err, os.ErrNotExist) {
			if err := root.Mkdir(dir, 0755); err == nil {
				created = true
			} else if !errors.Is(err, os.ErrExist) {
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
		if created {
			s.createdDirs[directoryKey(dir)] = info
		}
	}
	return nil
}

// Called with s.mu held. Remove only empty ancestors created by this service,
// and preserve directories reserved by active uploads or recursive deletions.
func (s *FileService) cleanupParents(name string) {
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return
	}
	defer root.Close()
	for dir := filepath.Dir(filepath.FromSlash(name)); dir != "."; dir = filepath.Dir(dir) {
		key := directoryKey(dir)
		created, owned := s.createdDirs[key]
		if !owned {
			break
		}
		if s.deletionOverlaps(filepath.ToSlash(dir)) {
			return
		}
		for reserved := range s.names {
			if strings.HasPrefix(reserved, nameKey(key)+"/") {
				return
			}
		}
		info, err := root.Lstat(dir)
		if errors.Is(err, os.ErrNotExist) {
			delete(s.createdDirs, key)
			continue
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return
		}
		if !os.SameFile(created, info) {
			delete(s.createdDirs, key)
			return
		}
		// Remove is deliberately non-recursive; existing files or directories win.
		if err := root.Remove(dir); err != nil {
			return
		}
		delete(s.createdDirs, key)
	}
}
