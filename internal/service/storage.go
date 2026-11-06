package service

import (
	"time"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

const fileListingTTL = 2 * time.Second

type fileListing struct {
	files     []model.FileInfo
	totalSize int64
	expires   time.Time
}

func (s *UploadService) invalidateFiles() {
	s.listingMu.Lock()
	s.listing = nil
	s.listingMu.Unlock()
}

// Serialize refreshes so simultaneous list/disk requests share a single scan.
// A short TTL also discovers changes made outside this process.
func (s *UploadService) cachedFiles() ([]model.FileInfo, int64, error) {
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	if s.listing == nil || !time.Now().Before(s.listing.expires) {
		files, size, err := s.ListFiles()
		if err != nil {
			return nil, 0, err
		}
		s.listing = &fileListing{files: files, totalSize: size, expires: time.Now().Add(fileListingTTL)}
	}
	return append([]model.FileInfo{}, s.listing.files...), s.listing.totalSize, nil
}

type StorageInfo struct {
	Files     []model.FileInfo
	TotalSize int64
	Disk      utils.DiskUsage
}

func (s *UploadService) StorageInfo() (StorageInfo, error) {
	files, totalSize, err := s.cachedFiles()
	if err != nil {
		return StorageInfo{}, err
	}
	disk, err := utils.GetDiskUsage(s.uploadDir)
	if err != nil {
		return StorageInfo{}, err
	}
	return StorageInfo{Files: files, TotalSize: totalSize, Disk: disk}, nil
}
