package service

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

func TestFileBrowserQueriesAndInvalidation(t *testing.T) {
	s := testService(t)
	for i := 0; i < 25; i++ {
		name := filepath.Join(s.uploadDir, "文档", fmt.Sprintf("file %02d.txt", i))
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, make([]byte, i+1), 0600); err != nil {
			t.Fatal(err)
		}
	}
	read := func(query BrowserQuery) (BrowserPage, uint64) {
		t.Helper()
		result, version, err := s.FileBrowserSnapshot(query)
		if err != nil {
			t.Fatal(err)
		}
		return result, version
	}
	query := BrowserQuery{Sort: "name_asc", Page: 1, PageSize: 20}
	root, rootTag := read(query)
	if root.Total != 1 || root.FolderCount != 1 || !root.Files[0].Folder || root.TotalFiles != 25 {
		t.Fatalf("root: %+v", root)
	}
	query.Directory = "文档"
	query.Page = 2
	second, tag := read(query)
	if second.Page != 2 || second.TotalPages != 2 || len(second.Files) != 5 || second.Files[0].Label != "file 20.txt" {
		t.Fatalf("second: %+v", second)
	}
	if tag != rootTag {
		t.Fatal("queries must share a listing generation")
	}
	_, sameTag := read(query)
	if sameTag != tag {
		t.Fatal("unchanged page changed validator")
	}
	query.Search = "FILE 24"
	search, _ := read(query)
	if search.Page != 1 || search.Total != 1 || search.Files[0].Label != "文档/file 24.txt" {
		t.Fatalf("search: %+v", search)
	}
	query.Search = "missing"
	empty, _ := read(query)
	if empty.Total != 0 || empty.Files == nil || empty.TotalPages != 1 {
		t.Fatalf("empty: %+v", empty)
	}
	query.Search = ""
	query.Page = 1
	query.Sort = "size_desc"
	sorted, _ := read(query)
	if sorted.Files[0].Size != 25 {
		t.Fatal("size sorting failed")
	}
	query.Directory = "文档/removed/child"
	fallback, _ := read(query)
	if fallback.Directory != "文档" {
		t.Fatal("missing parent fallback failed")
	}
	query.Directory = "文档"
	if err := s.DeleteFile("文档/file 24.txt"); err != nil {
		t.Fatal(err)
	}
	updated, updatedTag := read(query)
	if updated.Total != 24 || updatedTag == tag {
		t.Fatal("deletion did not invalidate browser index")
	}
}

func TestFileBrowserSortsTimesByInstant(t *testing.T) {
	entries := newBrowserIndex(nil)
	if len(entries.children[""]) != 0 {
		t.Fatal("empty root")
	}
	// Use actual files with timestamps on either side of a timezone offset.
	s := testService(t)
	for _, name := range []string{"a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(s.uploadDir, name), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.FileBrowserSnapshot(BrowserQuery{Page: 1, PageSize: 20}); err != nil {
		t.Fatal(err)
	}
	s.listing.files[0].Mtime = "2026-11-06T20:00:00+08:00"
	s.listing.files[1].Mtime = "2026-11-06T13:00:00Z"
	s.listing.browser = nil
	result, _, err := s.FileBrowserSnapshot(BrowserQuery{Sort: "mtime_desc", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if result.Files[0].Mtime != "2026-11-06T13:00:00Z" {
		t.Fatal("timestamp sorted lexically instead of by instant")
	}
}

func TestFileBrowserCacheIsBoundedAndCallerIsolated(t *testing.T) {
	s := testService(t)
	if err := os.WriteFile(filepath.Join(s.uploadDir, "entry.txt"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	var readers sync.WaitGroup
	for i := 0; i < 48; i++ {
		readers.Go(func() {
			query := BrowserQuery{Page: i + 1, PageSize: 20}
			result, _, err := s.FileBrowserSnapshot(query)
			if err != nil {
				t.Error(err)
				return
			}
			result.Directory = "corrupted"
			result.Files[0].Label = "corrupted"
			fresh, _, err := s.FileBrowserSnapshot(query)
			if err != nil || fresh.Directory == "corrupted" || len(fresh.Files) != 1 || fresh.Files[0].Label != "entry.txt" {
				t.Errorf("caller corrupted cached snapshot: %v", err)
			}
		})
	}
	readers.Wait()
	if len(s.listing.browser.pages) > 32 {
		t.Fatal("query cache grew beyond its bound")
	}
}

func BenchmarkFileBrowserCachedPage(b *testing.B) {
	s := NewFileService(b.TempDir(), b.TempDir())
	b.Cleanup(func() { s.Close() })
	files := make([]model.FileInfo, 50000)
	for i := range files {
		files[i] = model.FileInfo{Name: fmt.Sprintf("folder/file-%05d.txt", i), Mtime: "2026-11-06T13:00:00Z", SizeDisplay: "1 B", Size: 1}
	}
	s.listing = &fileListing{files: files, totalSize: 50000, expires: time.Now().Add(time.Hour)}
	query := BrowserQuery{Directory: "folder", Sort: "name_asc", Page: 100, PageSize: 20}
	if _, _, err := s.FileBrowserSnapshot(query); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, _, err := s.FileBrowserSnapshot(query); err != nil {
			b.Fatal(err)
		}
	}
}
