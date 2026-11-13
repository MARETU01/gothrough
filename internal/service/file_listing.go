package service

import (
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
	version   uint64
	browser   *browserIndex
}

func (s *FileService) invalidateFiles() {
	s.listingMu.Lock()
	s.listing = nil
	s.listingMu.Unlock()
}

// Serialize refreshes so simultaneous list/disk requests share a single scan.
// A short TTL also discovers changes made outside this process.
func (s *FileService) cachedFiles() ([]model.FileInfo, int64, error) {
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	if err := s.refreshListingLocked(); err != nil {
		return nil, 0, err
	}
	return append([]model.FileInfo{}, s.listing.files...), s.listing.totalSize, nil
}

func (s *FileService) refreshListingLocked() error {
	if s.listing == nil || !time.Now().Before(s.listing.expires) {
		files, size, err := s.ListFiles()
		if err != nil {
			return err
		}
		if s.listing != nil && s.listing.totalSize == size && slices.Equal(s.listing.files, files) {
			s.listing.expires = time.Now().Add(fileListingTTL)
			return nil
		}
		s.listingVersion++
		s.listing = &fileListing{files: files, totalSize: size, expires: time.Now().Add(fileListingTTL), version: s.listingVersion}
	}
	return nil
}

// FileList is detached from the cache; callers may modify their own copy.
type FileList struct {
	Files            []model.FileInfo `json:"files"`
	TotalSize        int64            `json:"total_size"`
	TotalSizeDisplay string           `json:"total_size_display"`
	HasFiles         bool             `json:"has_files"`
}

// ListingSnapshot retains an immutable file generation. Acquiring it does not
// copy all entries; Data returns an isolated copy only when a consumer needs it.
type ListingSnapshot struct {
	files     []model.FileInfo
	totalSize int64
}

func (snapshot ListingSnapshot) Data() FileList {
	return FileList{Files: append([]model.FileInfo{}, snapshot.files...), TotalSize: snapshot.totalSize,
		TotalSizeDisplay: utils.FormatFileSize(snapshot.totalSize), HasFiles: len(snapshot.files) > 0}
}

// FileListSnapshot returns a read-only snapshot and its generation, independent of HTTP encoding.
func (s *FileService) FileListSnapshot() (ListingSnapshot, uint64, error) {
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	if err := s.refreshListingLocked(); err != nil {
		return ListingSnapshot{}, 0, err
	}
	listing := s.listing
	return ListingSnapshot{files: listing.files, totalSize: listing.totalSize}, listing.version, nil
}

type StorageInfo struct {
	Files     []model.FileInfo
	TotalSize int64
	Disk      utils.DiskUsage
}

type StorageStats struct {
	TotalFiles int
	TotalSize  int64
	Disk       utils.DiskUsage
}

// StorageStats reads only aggregate metadata, without copying the file list.
func (s *FileService) StorageStats() (StorageStats, error) {
	s.listingMu.Lock()
	if err := s.refreshListingLocked(); err != nil {
		s.listingMu.Unlock()
		return StorageStats{}, err
	}
	stats := StorageStats{TotalFiles: len(s.listing.files), TotalSize: s.listing.totalSize}
	s.listingMu.Unlock()
	disk, err := utils.GetDiskUsage(s.uploadDir)
	stats.Disk = disk
	return stats, err
}

func (s *FileService) StorageInfo() (StorageInfo, error) {
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
