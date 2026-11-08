package service

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

var ErrFileInaccessible = errors.New("文件不存在或无法访问")

// RelativePath is the shared lexical path policy for reads, edits, and deletion.
// The caller supplies a literal name that the HTTP router has already decoded.
func (s *FileService) RelativePath(filename string) string {
	return utils.SafeUploadRelpath(filename, s.uploadDir)
}

// OpenFile confines the filesystem lookup to this service's upload directory.
// The caller owns the returned handle; the root handle can be released here.
func (s *FileService) OpenFile(filename string) (*os.File, os.FileInfo, error) {
	rel := s.RelativePath(filename)
	if rel == "" {
		return nil, nil, ErrFileInaccessible
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return nil, nil, err
	}
	defer root.Close()
	file, err := root.Open(rel)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %w", ErrFileInaccessible, err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return nil, nil, ErrFileInaccessible
	}
	return file, info, nil
}

func (s *FileService) ListFiles() ([]model.FileInfo, int64, error) {
	entries := []model.FileInfo{}
	var totalSize int64

	err := filepath.WalkDir(s.uploadDir, func(path string, f fs.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil // A concurrent deletion should not fail the entire listing.
			}
			return err
		}
		if f.IsDir() || !f.Type().IsRegular() {
			return nil
		}
		info, err := f.Info()
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		rel, err := filepath.Rel(s.uploadDir, path)
		if err != nil {
			return err
		}
		entries = append(entries, model.FileInfo{
			Name:        filepath.ToSlash(rel),
			Size:        info.Size(),
			SizeDisplay: utils.FormatFileSize(info.Size()),
			Mtime:       info.ModTime().Format(time.RFC3339Nano),
		})
		totalSize += info.Size()
		return nil
	})
	if err != nil {
		return nil, 0, err
	}

	sort.Slice(entries, func(i, j int) bool {
		left, _ := time.Parse(time.RFC3339Nano, entries[i].Mtime)
		right, _ := time.Parse(time.RFC3339Nano, entries[j].Mtime)
		return left.After(right)
	})

	return entries, totalSize, nil
}

// 删除已上传的文件
func (s *FileService) DeleteFile(filename string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rel := s.RelativePath(filename)
	if rel == "" {
		return fmt.Errorf("无效文件名")
	}

	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := root.Lstat(rel)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("只能删除文件")
	}
	if err := root.Remove(rel); err != nil {
		return err
	}
	s.cleanupParents(rel)
	s.invalidateFiles()
	return nil
}
