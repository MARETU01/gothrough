package service

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

func TestUploadParentConflictsAreRejectedBeforeTransfer(t *testing.T) {
	s := testService(t)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "existing"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InitSession(model.InitRequest{Filename: "child.txt", RelativePath: "existing/child.txt", TotalSize: 4}); !errors.Is(err, ErrPathConflict) {
		t.Fatalf("existing parent: %v", err)
	}
	pending := smallSession(t, s, "pending", 4)
	if _, err := s.InitSession(model.InitRequest{Filename: "child.txt", RelativePath: "pending/child.txt", TotalSize: 4}); !errors.Is(err, ErrPathConflict) {
		t.Fatalf("reserved parent: %v", err)
	}
	if len(s.sessions) != 1 {
		t.Fatal("rejected session leaked")
	}
	if err := s.CancelSession(pending.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InitSession(model.InitRequest{Filename: "child.txt", RelativePath: "pending/child.txt", TotalSize: 4}); err != nil {
		t.Fatalf("cancelled reservation not released: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(s.uploadDir, "existing"))
	if err != nil || string(data) != "keep" {
		t.Fatal("existing file changed")
	}
}

func TestConcurrentParentReservations(t *testing.T) {
	s := testService(t)
	var wg sync.WaitGroup
	for _, request := range []model.InitRequest{{Filename: "parent"}, {Filename: "child", RelativePath: "parent/child"}} {
		wg.Add(1)
		go func(req model.InitRequest) {
			defer wg.Done()
			if _, err := s.InitSession(req); err != nil && !errors.Is(err, ErrPathConflict) {
				t.Error(err)
			}
		}(request)
	}
	wg.Wait()
	if s.names["parent"] && s.names["parent/child"] {
		t.Fatal("incompatible paths reserved concurrently")
	}
}

func TestLongUnicodeUploadsAndConflicts(t *testing.T) {
	s := testService(t)
	name := strings.Repeat("😀中文", 100) + ".txt"
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		info := smallSession(t, s, name, 4)
		// Force publication-time conflict too, after initialization succeeded.
		if i == 1 {
			if err := os.WriteFile(filepath.Join(s.uploadDir, info.FinalFilename), []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data")); err != nil {
			t.Fatal(err)
		}
		final, _, err := s.CompleteSession(info.SessionID)
		if err != nil {
			t.Fatal(err)
		}
		if len(final) > utils.MaxFilenameBytes || !strings.HasSuffix(final, ".txt") || seen[final] {
			t.Fatalf("invalid final name: %s", final)
		}
		seen[final] = true
		data, err := os.ReadFile(filepath.Join(s.uploadDir, final))
		if err != nil || string(data) != "data" {
			t.Fatalf("saved file: %q %v", data, err)
		}
	}
}

func TestInsufficientSpaceDoesNotAllocateSession(t *testing.T) {
	s := testService(t)
	s.diskUsage = func(string) (utils.DiskUsage, error) { return utils.DiskUsage{Free: 1}, nil }
	if _, err := s.InitSession(model.InitRequest{Filename: "large.bin", TotalSize: 2}); !errors.Is(err, utils.ErrStorageFull) {
		t.Fatalf("space check: %v", err)
	}
	if len(s.sessions) != 0 || len(s.names) != 0 {
		t.Fatal("failed space check reserved a session")
	}
	entries, err := os.ReadDir(s.tempDir)
	if err != nil || len(entries) != 0 {
		t.Fatal("failed space check left data")
	}
	s.diskUsage = utils.GetDiskUsage
	if _, err := s.InitSession(model.InitRequest{Filename: "large.bin", TotalSize: 2}); err != nil {
		t.Fatalf("retry after freeing space: %v", err)
	}
}

func TestParentChangedAfterInit(t *testing.T) {
	s := testService(t)
	info, err := s.InitSession(model.InitRequest{Filename: "a.txt", RelativePath: "folder/a.txt"})
	if err != nil {
		t.Fatal(err)
	}
	parent := filepath.Join(s.uploadDir, "folder")
	if err := os.Remove(parent); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(parent, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(info.SessionID); !errors.Is(err, ErrPathConflict) {
		t.Fatalf("publication recheck: %v", err)
	}
}
