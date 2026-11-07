package service

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

const fileListingTTL = 2 * time.Second

type fileListing struct {
	files     []model.FileInfo
	totalSize int64
	expires   time.Time
	body      string
	etag      string
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
	if err := s.refreshListingLocked(); err != nil {
		return nil, 0, err
	}
	return append([]model.FileInfo{}, s.listing.files...), s.listing.totalSize, nil
}

func (s *UploadService) refreshListingLocked() error {
	if s.listing == nil || !time.Now().Before(s.listing.expires) {
		files, size, err := s.ListFiles()
		if err != nil {
			return err
		}
		if s.listing != nil && s.listing.totalSize == size && slices.Equal(s.listing.files, files) {
			s.listing.expires = time.Now().Add(fileListingTTL)
			return nil
		}
		body, err := json.Marshal(struct {
			Files            []model.FileInfo `json:"files"`
			TotalSize        int64            `json:"total_size"`
			TotalSizeDisplay string           `json:"total_size_display"`
			HasFiles         bool             `json:"has_files"`
		}{files, size, utils.FormatFileSize(size), len(files) > 0})
		if err != nil {
			return err
		}
		s.listing = &fileListing{files: files, totalSize: size, expires: time.Now().Add(fileListingTTL), body: string(body), etag: fmt.Sprintf(`"%x"`, sha256.Sum256(body))}
	}
	return nil
}

// The cached JSON and validator are immutable and exclude volatile disk space.
func (s *UploadService) FileListSnapshot() (string, string, error) {
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	if err := s.refreshListingLocked(); err != nil {
		return "", "", err
	}
	return s.listing.body, s.listing.etag, nil
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
