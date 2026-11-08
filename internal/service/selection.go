package service

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const MaxSelectionEntries = 100

var (
	ErrSelection        = errors.New("文件选择无效")
	ErrSelectionChanged = errors.New("文件或文件夹类型已变化，请刷新后重试")
	ErrFolderBusy       = errors.New("文件夹内有未完成上传，请完成或取消后重试")
)

type SelectionEntry struct {
	Path   string `json:"path"`
	Folder bool   `json:"folder"`
}

type DeletionResult struct {
	Path string
	Err  error
}

// Validate all lexical paths before any mutation. Selection paths are literal,
// canonical names, not URL-escaped strings or filesystem paths supplied by clients.
func (s *FileService) validateSelection(entries []SelectionEntry) error {
	if len(entries) == 0 || len(entries) > MaxSelectionEntries {
		return ErrSelection
	}
	seen := make(map[string]bool)
	for _, entry := range entries {
		name := entry.Path
		if len(name) > 4096 || strings.ContainsAny(name, "\\:\x00") || name == "." || path.Clean(name) != name ||
			s.RelativePath(name) == "" || seen[directoryKey(name)] {
			return ErrSelection
		}
		seen[directoryKey(name)] = true
	}
	return nil
}

// Reject symlinks in every component, even links to another location inside uploads.
func selectionInfo(root *os.Root, name string) (os.FileInfo, error) {
	current := ""
	var info os.FileInfo
	for _, part := range strings.Split(name, "/") {
		current = path.Join(current, part)
		var err error
		info, err = root.Lstat(current)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return nil, ErrFileInaccessible
		}
	}
	return info, nil
}

// DeleteSelection reports each requested outcome. Children precede selected
// parents; unrelated failures never erase successful outcomes. A folder mutation
// uses the same lock as publication/reservations, editing, and single deletion.
func (s *FileService) DeleteSelection(ctx context.Context, entries []SelectionEntry) ([]DeletionResult, error) {
	if err := s.validateSelection(entries); err != nil {
		return nil, err
	}
	order := make([]int, len(entries))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(i, j int) bool {
		return strings.Count(entries[order[i]].Path, "/") > strings.Count(entries[order[j]].Path, "/")
	})
	results := make([]DeletionResult, len(entries))
	for _, index := range order {
		entry := entries[index]
		results[index] = DeletionResult{Path: entry.Path, Err: s.deleteSelected(ctx, entry)}
	}
	return results, nil
}

func (s *FileService) deleteSelected(ctx context.Context, entry SelectionEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := selectionInfo(root, entry.Path)
	if err != nil {
		return err
	}
	if info.IsDir() != entry.Folder {
		return ErrSelectionChanged
	}
	if entry.Folder {
		key := nameKey(entry.Path)
		for reserved := range s.names {
			if reserved == key || strings.HasPrefix(reserved, key+"/") {
				return ErrFolderBusy
			}
		}
		folder, err := root.OpenRoot(entry.Path)
		if err != nil {
			return err
		}
		// Preflight special entries before removing any content. External changes
		// can still interrupt a deletion; callers must not treat it as atomic.
		err = fs.WalkDir(folder.FS(), ".", func(_ string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if !entry.IsDir() && !entry.Type().IsRegular() {
				return ErrFileInaccessible
			}
			return nil
		})
		if err == nil {
			defer s.invalidateFiles() // also invalidate if a recursive deletion only partly succeeds
			err = removeSelectedContents(ctx, folder)
		}
		closeErr := folder.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		current, err := root.Lstat(entry.Path)
		if err != nil {
			return err
		}
		if !os.SameFile(info, current) {
			return ErrSelectionChanged
		}
	}
	if err := root.Remove(entry.Path); err != nil {
		return err
	}
	if entry.Folder {
		key := directoryKey(entry.Path)
		for owned := range s.createdDirs {
			if owned == key || strings.HasPrefix(owned, key+"/") {
				delete(s.createdDirs, owned)
			}
		}
	}
	s.cleanupParents(filepath.FromSlash(entry.Path))
	s.invalidateFiles()
	return nil
}

func removeSelectedContents(ctx context.Context, root *os.Root) error {
	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := root.Lstat(entry.Name())
		if err != nil {
			return err
		}
		if info.IsDir() {
			child, err := root.OpenRoot(entry.Name())
			if err != nil {
				return err
			}
			err = removeSelectedContents(ctx, child)
			closeErr := child.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
		} else if !info.Mode().IsRegular() {
			return ErrFileInaccessible
		}
		current, err := root.Lstat(entry.Name())
		if err != nil {
			return err
		}
		if !os.SameFile(info, current) {
			return ErrSelectionChanged
		}
		if err := root.Remove(entry.Name()); err != nil {
			return err
		}
	}
	return nil
}
