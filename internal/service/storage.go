package service

import (
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

type StorageInfo struct {
	Files     []model.FileInfo
	TotalSize int64
	Disk      utils.DiskUsage
}

func (s *UploadService) StorageInfo() (StorageInfo, error) {
	files, totalSize, err := s.ListFiles()
	if err != nil {
		return StorageInfo{}, err
	}
	disk, err := utils.GetDiskUsage(s.uploadDir)
	if err != nil {
		return StorageInfo{}, err
	}
	return StorageInfo{Files: files, TotalSize: totalSize, Disk: disk}, nil
}
