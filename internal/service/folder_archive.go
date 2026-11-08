package service

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// FolderArchive holds a directory handle for one download, independent of renames.
type FolderArchive struct {
	root *os.Root
	Name string
}

func (s *FileService) OpenFolder(name string) (*FolderArchive, error) {
	rel := s.RelativePath(name)
	if rel == "" {
		return nil, ErrFileInaccessible
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	// Reject symlink components, including links to other uploaded directories.
	current := ""
	for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
		current = path.Join(current, part)
		info, err := root.Lstat(current)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, ErrFileInaccessible
		}
	}
	folder, err := root.OpenRoot(rel)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFileInaccessible, err)
	}
	return &FolderArchive{root: folder, Name: path.Base(filepath.ToSlash(rel))}, nil
}

func (a *FolderArchive) Close() error { return a.root.Close() }

// WriteZIP streams regular files without following directory symlinks. A failed
// archive deliberately has no central directory, so it cannot look complete.
func (a *FolderArchive) WriteZIP(ctx context.Context, dst io.Writer) error {
	archive := zip.NewWriter(dst)
	err := fs.WalkDir(a.root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 || (!entry.IsDir() && !entry.Type().IsRegular()) {
			return nil
		}
		archiveName := path.Join(a.Name, name)
		if !fs.ValidPath(archiveName) || strings.ContainsAny(archiveName, "\\:") {
			return fmt.Errorf("unsafe archive path")
		}
		info, err := a.root.Lstat(name)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("archive entry changed during download")
		}
		if info.IsDir() {
			_, err := archive.CreateHeader(&zip.FileHeader{Name: archiveName + "/"})
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		file, err := a.root.Open(name)
		if err != nil {
			return err
		}
		defer file.Close() // callback returns before the next file is opened
		opened, err := file.Stat()
		if err != nil {
			return err
		}
		if !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
			return fmt.Errorf("archive entry changed during download")
		}
		header, err := zip.FileInfoHeader(opened)
		if err != nil {
			return err
		}
		header.Name, header.Method = archiveName, zip.Deflate
		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		_, err = io.CopyN(writer, contextReader{ctx, file}, opened.Size())
		return err
	})
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return archive.Close()
}

type contextReader struct {
	ctx context.Context
	src io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.src.Read(p)
}
