package service

import (
	"os"
	"sync"

	"github.com/MARETU01/gothrough/internal/utils"
)

// FileService coordinates upload publication, reservations, editing, deletion,
// and directory reclamation for one storage instance. Mutation admission and
// path reservations share mu; recursive deletion performs tree I/O outside mu.
// Lifecycle and listing locks retain their existing ownership.
//
// Lock order: session.lifecycle -> FileService.mu -> session.mu/listingMu.
// Lookups release FileService.mu before acquiring session.lifecycle. Chunk
// writers hold lifecycle.RLock -> block lock -> session.mu, never FileService.mu.
// Listing scans hold only listingMu and never acquire mutation/session locks.
// Expiration copies session references under mu, then uses lifecycle.TryLock.
// FileHandler's response cache is independent; it never calls services while locked.
type FileService struct {
	mu             sync.RWMutex
	sessions       map[string]*transferSession
	completed      map[string]completedSession
	names          map[string]bool
	deleting       map[string]bool        // guarded by mu; reservations for recursive deletions
	createdDirs    map[string]os.FileInfo // guarded by mu; only directories created by this service
	uploadDir      string
	tempDir        string
	slots          chan struct{}
	diskUsage      func(string) (utils.DiskUsage, error)
	listingMu      sync.Mutex
	listing        *fileListing
	listingVersion uint64
}

func NewFileService(uploadDir, tempDir string) *FileService {
	return &FileService{sessions: make(map[string]*transferSession), completed: make(map[string]completedSession), names: make(map[string]bool), deleting: make(map[string]bool), createdDirs: make(map[string]os.FileInfo),
		uploadDir: uploadDir, tempDir: tempDir, slots: make(chan struct{}, MaxConcurrentChunks), diskUsage: utils.GetDiskUsage}
}
