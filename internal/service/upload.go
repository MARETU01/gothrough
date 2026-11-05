package service

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

func (s *UploadService) ListFiles() ([]model.FileInfo, int64, error) {
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
			Mtime:       info.ModTime().Format("2006-01-02 15:04:05"),
		})
		totalSize += info.Size()
		return nil
	})
	if err != nil {
		return nil, 0, err
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Mtime > entries[j].Mtime
	})

	return entries, totalSize, nil
}

// 删除已上传的文件
func (s *UploadService) DeleteFile(filename string) error {
	rel := utils.SafeUploadRelpath(filename, s.uploadDir)
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
	return root.Remove(rel)
}
