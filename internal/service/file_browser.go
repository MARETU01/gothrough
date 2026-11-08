package service

import (
	"cmp"
	"slices"
	"strings"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
)

type BrowserQuery struct {
	Directory string
	Search    string
	Sort      string
	Page      int
	PageSize  int
}

type BrowserEntry struct {
	model.FileInfo
	Folder bool   `json:"folder"`
	Label  string `json:"label"`
}

type BrowserPage struct {
	Files            []BrowserEntry `json:"files"`
	Directory        string         `json:"directory"`
	Total            int            `json:"total"`
	FolderCount      int            `json:"folder_count"`
	TotalFiles       int            `json:"total_files"`
	Page             int            `json:"page"`
	PageSize         int            `json:"page_size"`
	TotalPages       int            `json:"total_pages"`
	TotalSizeDisplay string         `json:"total_size_display"`
}

// The directory index belongs to an immutable listing generation. Requests only
// copy and sort the selected directory; searches scan the cached file metadata.
type browserIndex struct {
	children map[string][]BrowserEntry
	pages    map[BrowserQuery]BrowserPage
}

func cloneBrowserPage(page BrowserPage) BrowserPage {
	page.Files = append([]BrowserEntry{}, page.Files...)
	return page
}

func newBrowserIndex(files []model.FileInfo) *browserIndex {
	index := &browserIndex{children: map[string][]BrowserEntry{"": {}}, pages: make(map[BrowserQuery]BrowserPage)}
	for _, file := range files {
		parts := strings.Split(file.Name, "/")
		parent := ""
		for i := 0; i < len(parts)-1; i++ {
			name := strings.Join(parts[:i+1], "/")
			if _, exists := index.children[name]; !exists {
				index.children[name] = []BrowserEntry{}
				index.children[parent] = append(index.children[parent], BrowserEntry{FileInfo: model.FileInfo{Name: name, SizeDisplay: "—"}, Folder: true, Label: parts[i]})
			}
			parent = name
		}
		index.children[parent] = append(index.children[parent], BrowserEntry{FileInfo: file, Label: parts[len(parts)-1]})
	}
	return index
}

func (s *FileService) FileBrowserSnapshot(query BrowserQuery) (BrowserPage, uint64, error) {
	s.listingMu.Lock()
	if err := s.refreshListingLocked(); err != nil {
		s.listingMu.Unlock()
		return BrowserPage{}, 0, err
	}
	listing := s.listing
	if listing.browser == nil {
		listing.browser = newBrowserIndex(listing.files)
	}
	index := listing.browser
	if cached, ok := index.pages[query]; ok {
		s.listingMu.Unlock()
		return cloneBrowserPage(cached), listing.version, nil
	}
	s.listingMu.Unlock()

	directory := query.Directory
	for directory != "" {
		if _, exists := index.children[directory]; exists {
			break
		}
		if split := strings.LastIndexByte(directory, '/'); split >= 0 {
			directory = directory[:split]
		} else {
			directory = ""
		}
	}
	keyword := strings.ToLower(strings.TrimSpace(query.Search))
	entries := []BrowserEntry{}
	if keyword == "" {
		entries = append(entries, index.children[directory]...)
	} else {
		for _, file := range listing.files {
			if strings.Contains(strings.ToLower(file.Name), keyword) {
				entries = append(entries, BrowserEntry{FileInfo: file, Label: file.Name})
			}
		}
	}
	folderCount := 0
	for _, entry := range entries {
		if entry.Folder {
			folderCount++
		}
	}
	field, direction, _ := strings.Cut(query.Sort, "_")
	slices.SortFunc(entries, func(a, b BrowserEntry) int {
		if a.Folder != b.Folder {
			if a.Folder {
				return -1
			}
			return 1
		}
		comparison := 0
		switch {
		case field == "name" || a.Folder:
			comparison = strings.Compare(strings.ToLower(a.Label), strings.ToLower(b.Label))
		case field == "size":
			comparison = cmp.Compare(a.Size, b.Size)
		default:
			left, _ := time.Parse(time.RFC3339Nano, a.Mtime)
			right, _ := time.Parse(time.RFC3339Nano, b.Mtime)
			comparison = left.Compare(right)
		}
		if direction == "desc" && (!a.Folder || field == "name") {
			comparison = -comparison
		}
		if comparison == 0 {
			return strings.Compare(a.Name, b.Name)
		}
		return comparison
	})
	pageSize := max(1, min(query.PageSize, 100))
	totalPages := max(1, (len(entries)+pageSize-1)/pageSize)
	page := max(1, min(query.Page, totalPages))
	start := (page - 1) * pageSize
	result := BrowserPage{Files: entries[start:min(start+pageSize, len(entries))], Directory: directory,
		Total: len(entries), FolderCount: folderCount, TotalFiles: len(listing.files), Page: page,
		PageSize: pageSize, TotalPages: totalPages, TotalSizeDisplay: utils.FormatFileSize(listing.totalSize)}
	s.listingMu.Lock()
	if s.listing == listing {
		// Bound query caches even when users enter many different searches.
		if len(index.pages) >= 32 {
			for key := range index.pages {
				delete(index.pages, key)
				break
			}
		}
		// Retain only the page, not the backing array of all matching entries.
		index.pages[query] = cloneBrowserPage(result)
	}
	s.listingMu.Unlock()
	return cloneBrowserPage(result), listing.version, nil
}
