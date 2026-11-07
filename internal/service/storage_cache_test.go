package service

import (
	"bytes"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestFileCacheExpiryAndCallerIsolation(t *testing.T) {
	s := testService(t)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "first"), []byte("a"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := s.StorageInfo()
	if err != nil || len(first.Files) != 1 || first.TotalSize != 1 {
		t.Fatalf("initial listing: %+v %v", first, err)
	}
	first.Files[0].Name = "modified by caller"
	if err := os.WriteFile(filepath.Join(s.uploadDir, "external"), []byte("bc"), 0600); err != nil {
		t.Fatal(err)
	}
	cached, err := s.StorageInfo()
	if err != nil || len(cached.Files) != 1 || cached.Files[0].Name != "first" {
		t.Fatalf("cache not isolated or reused: %+v %v", cached, err)
	}
	s.listing.expires = time.Now().Add(-time.Second)
	refreshed, err := s.StorageInfo()
	if err != nil || len(refreshed.Files) != 2 || refreshed.TotalSize != 3 {
		t.Fatalf("external change not discovered: %+v %v", refreshed, err)
	}
}

func TestFileCacheInvalidatedByUploadAndDelete(t *testing.T) {
	s := testService(t)
	if _, err := s.StorageInfo(); err != nil {
		t.Fatal(err)
	}
	info := smallSession(t, s, "new.txt", 4)
	if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data")); err != nil {
		t.Fatal(err)
	}
	name, _, err := s.CompleteSession(info.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	var readers sync.WaitGroup
	for range 8 {
		readers.Go(func() {
			listing, err := s.StorageInfo()
			if err != nil || len(listing.Files) != 1 || listing.TotalSize != 4 {
				t.Errorf("uploaded file missing: %+v %v", listing, err)
			}
		})
	}
	readers.Wait()
	if err := s.DeleteFile(name); err != nil {
		t.Fatal(err)
	}
	listing, err := s.StorageInfo()
	if err != nil || len(listing.Files) != 0 || listing.TotalSize != 0 {
		t.Fatalf("deleted file remains: %+v %v", listing, err)
	}
}

func TestFileCacheDoesNotHideScanErrors(t *testing.T) {
	s := testService(t)
	originalDir := s.uploadDir
	// An invalid path fails on all platforms, even when tests run as root.
	s.uploadDir = "\x00"
	if _, err := s.StorageInfo(); err == nil {
		t.Fatal("invalid storage root accepted")
	}
	s.uploadDir = originalDir
	if _, err := s.StorageInfo(); err != nil {
		t.Fatalf("storage did not recover: %v", err)
	}
}

func TestFileSnapshotVersionSurvivesExpiryAndDiscoversExternalChanges(t *testing.T) {
	s := testService(t)
	body, tag, err := s.FileListSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	s.listing.expires = time.Now().Add(-time.Second)
	unchanged, next, err := s.FileListSnapshot()
	if err != nil || tag != next || body != unchanged {
		t.Fatalf("unchanged scan changed snapshot: %s %s %v", tag, next, err)
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, "external.txt"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	s.listing.expires = time.Now().Add(-time.Second)
	changed, next, err := s.FileListSnapshot()
	if err != nil || tag == next || changed == body {
		t.Fatalf("external change not versioned: %v", err)
	}
}
