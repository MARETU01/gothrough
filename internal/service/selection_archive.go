package service

import (
	"archive/zip"
	"context"
	"io"
	"os"
	"path"
	"sort"
)

type selectedArchiveEntry struct {
	name   string
	folder *FolderArchive
	file   *os.File
	info   os.FileInfo
}

// SelectionArchive holds only bounded open handles, never a temporary ZIP or
// an in-memory file body. Names retain upload-relative paths to avoid collisions.
type SelectionArchive struct{ entries []selectedArchiveEntry }

func (s *FileService) OpenSelection(paths []string) (*SelectionArchive, error) {
	entries := make([]SelectionEntry, len(paths))
	for i, name := range paths {
		entries[i].Path = name
	}
	if err := s.validateSelection(entries); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	// Validate every requested entry, then collapse parent/child overlap before
	// opening handles. Sorting keeps archive output independent of checkbox order.
	selected := make(map[string]bool, len(paths))
	for _, name := range paths {
		if _, err := selectionInfo(root, name); err != nil {
			return nil, err
		}
		selected[directoryKey(name)] = true
	}
	ordered := append([]string{}, paths...)
	sort.Strings(ordered)
	archive := &SelectionArchive{}
	for _, name := range ordered {
		covered := false
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if selected[directoryKey(parent)] {
				covered = true
				break
			}
		}
		if covered {
			continue
		}
		info, err := selectionInfo(root, name)
		if err != nil {
			archive.Close()
			return nil, err
		}
		entry := selectedArchiveEntry{name: name}
		if info.IsDir() {
			entry.folder, err = s.OpenFolder(name)
			if err == nil {
				entry.folder.Name = name
			}
		} else {
			entry.file, entry.info, err = s.OpenFile(name)
		}
		if err != nil {
			archive.Close()
			return nil, err
		}
		archive.entries = append(archive.entries, entry)
	}
	return archive, nil
}

func (a *SelectionArchive) Close() {
	for _, entry := range a.entries {
		if entry.folder != nil {
			_ = entry.folder.Close()
		}
		if entry.file != nil {
			_ = entry.file.Close()
		}
	}
}

func (a *SelectionArchive) WriteZIP(ctx context.Context, dst io.Writer) error {
	archive := zip.NewWriter(dst)
	for _, entry := range a.entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.folder != nil {
			if err := entry.folder.writeZIP(ctx, archive); err != nil {
				return err
			}
			continue
		}
		header, err := zip.FileInfoHeader(entry.info)
		if err != nil {
			return err
		}
		header.Name, header.Method = entry.name, zip.Deflate
		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		if _, err := io.CopyN(writer, contextReader{ctx, entry.file}, entry.info.Size()); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return archive.Close()
}
