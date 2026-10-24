package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

func (s *UploadService) ListFiles() ([]model.FileInfo, int64, error) {
	entries := []model.FileInfo{}
	var totalSize int64

	files, err := os.ReadDir(s.uploadDir)
	if err != nil {
		return nil, 0, err
	}

	for _, f := range files {
		if f.IsDir() {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue
		}
		entries = append(entries, model.FileInfo{
			Name:        f.Name(),
			Size:        info.Size(),
			SizeDisplay: utils.FormatFileSize(info.Size()),
			Mtime:       info.ModTime().Format("2006-01-02 15:04:05"),
		})
		totalSize += info.Size()
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

	fullPath := filepath.Join(s.uploadDir, rel)

	rootReal, _ := filepath.Abs(s.uploadDir)
	fullReal, _ := filepath.Abs(fullPath)
	if fullReal != rootReal && !strings.HasPrefix(fullReal, rootReal+string(os.PathSeparator)) {
		return fmt.Errorf("拒绝访问")
	}

	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return fmt.Errorf("文件不存在")
	}

	return os.Remove(fullPath)
}
