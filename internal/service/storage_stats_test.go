package service

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestStorageStatsTrackCachedExpiryAndMutations(t *testing.T) {
	s := testService(t)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "one.txt"), []byte("one"), 0600); err != nil {
		t.Fatal(err)
	}
	check := func(count int, size int64) {
		t.Helper()
		stats, err := s.StorageStats()
		if err != nil || stats.TotalFiles != count || stats.TotalSize != size {
			t.Fatalf("stats: %+v %v", stats, err)
		}
	}
	check(1, 3)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "external.txt"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	check(1, 3)
	s.listing.expires = time.Now().Add(-time.Second)
	check(2, 4)
	if err := s.DeleteFile("one.txt"); err != nil {
		t.Fatal(err)
	}
	check(1, 1)
	if _, err := s.SaveText("external.txt", TextVersion([]byte("x")), "longer"); err != nil {
		t.Fatal(err)
	}
	check(1, 6)
	session, err := s.InitSession(model.InitRequest{Filename: "empty.txt", TotalSize: 0})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(session.SessionID); err != nil {
		t.Fatal(err)
	}
	check(2, 6)
}

func BenchmarkStorageMetadata(b *testing.B) {
	for _, mode := range []string{"full-list", "stats"} {
		b.Run(mode, func(b *testing.B) {
			s := NewFileService(b.TempDir(), b.TempDir())
			b.Cleanup(s.Close)
			s.listing = &fileListing{files: make([]model.FileInfo, 50000), totalSize: 50000, expires: time.Now().Add(time.Hour), version: 1}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				if mode == "stats" {
					if _, err := s.StorageStats(); err != nil {
						b.Fatal(err)
					}
				} else if _, err := s.StorageInfo(); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
