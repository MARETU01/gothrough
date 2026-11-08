package service

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
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

// Isolate the cost of acquiring an unchanged listing; no disk scan or JSON.
func BenchmarkFileListSnapshot(b *testing.B) {
	s := NewFileService(b.TempDir(), b.TempDir())
	files := make([]model.FileInfo, 50000)
	for i := range files {
		files[i] = model.FileInfo{Name: "file.txt", Size: 1}
	}
	s.listing = &fileListing{files: files, totalSize: 50000, expires: time.Now().Add(time.Hour), version: 1}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, _, err := s.FileListSnapshot(); err != nil {
			b.Fatal(err)
		}
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
	if err != nil || tag != next || !reflect.DeepEqual(body, unchanged) {
		t.Fatalf("unchanged scan changed snapshot: %d %d %v", tag, next, err)
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, "external.txt"), []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	s.listing.expires = time.Now().Add(-time.Second)
	changed, next, err := s.FileListSnapshot()
	if err != nil || tag == next || reflect.DeepEqual(changed, body) {
		t.Fatalf("external change not versioned: %v", err)
	}
}

func TestListingSnapshotsSurviveMutationsAndIsolateConsumers(t *testing.T) {
	s := testService(t)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "keep.txt"), []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, version, err := s.FileListSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	data := snapshot.Data()
	data.Files[0].Name = "caller mutation"
	if snapshot.Data().Files[0].Name != "keep.txt" {
		t.Fatal("consumer changed the snapshot")
	}
	if err := s.DeleteFile("keep.txt"); err != nil {
		t.Fatal(err)
	}
	current, next, err := s.FileListSnapshot()
	if err != nil || next == version || len(current.Data().Files) != 0 {
		t.Fatalf("new snapshot: %d %v", next, err)
	}
	if old := snapshot.Data(); len(old.Files) != 1 || old.Files[0].Name != "keep.txt" || old.TotalSize != 3 {
		t.Fatalf("retained snapshot changed after deletion: %+v", old)
	}
}
