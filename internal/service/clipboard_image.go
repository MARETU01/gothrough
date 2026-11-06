package service

import (
	"bytes"
	"errors"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
	"uuid"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/model"
)

var (
	ErrClipboardImage         = errors.New("请选择有效的 PNG 或 JPEG 图片")
	ErrClipboardImageSize     = errors.New("图片文件、转换后的 PNG 或像素数量超过限制")
	ErrClipboardImageQuota    = errors.New("剪贴板图片总容量不足，请删除部分图片后重试")
	ErrClipboardImageDisabled = errors.New("图片剪贴板已关闭")
)

func (s *ClipboardService) ImageSettings() config.ClipboardImageSettings { return s.imageSettings }

type limitedImageBuffer struct {
	bytes.Buffer
	limit int64
}

func (b *limitedImageBuffer) Write(p []byte) (int, error) {
	if int64(b.Len())+int64(len(p)) > b.limit {
		return 0, ErrClipboardImageSize
	}
	return b.Buffer.Write(p)
}

// Normalize both accepted formats to PNG: removes metadata and gives clipboard
// writers a single interoperable representation. Decoding is bounded and serial.
func (s *ClipboardService) CreateImage(input io.Reader) (model.ClipboardEntry, error) {
	if !s.imageSettings.Enabled {
		return model.ClipboardEntry{}, ErrClipboardImageDisabled
	}
	select {
	case s.imageSlot <- struct{}{}:
		defer func() { <-s.imageSlot }()
	default:
		return model.ClipboardEntry{}, ErrBusy
	}
	limit := int64(s.imageSettings.MaxSizeMB) * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(input, limit+1))
	if err != nil {
		return model.ClipboardEntry{}, err
	}
	if int64(len(data)) > limit {
		return model.ClipboardEntry{}, ErrClipboardImageSize
	}
	dim, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") {
		return model.ClipboardEntry{}, ErrClipboardImage
	}
	if dim.Width <= 0 || dim.Height <= 0 || int64(dim.Width) > int64(s.imageSettings.MaxPixels)/int64(dim.Height) {
		return model.ClipboardEntry{}, ErrClipboardImageSize
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return model.ClipboardEntry{}, ErrClipboardImage
	}
	encoded := &limitedImageBuffer{limit: limit}
	if err := png.Encode(encoded, decoded); err != nil {
		return model.ClipboardEntry{}, err
	}
	entry := model.ClipboardEntry{ID: uuid.NewV7().String(), Type: "image", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	entry.Image = model.ClipboardImage{URL: "/api/clipboard/" + entry.ID + "/image", MimeType: "image/png", Size: int64(encoded.Len()), Width: dim.Width, Height: dim.Height}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := append([]model.ClipboardEntry{entry}, s.entries[:min(len(s.entries), ClipboardMaxEntries-1)]...)
	var total int64
	for _, candidate := range next {
		total += candidate.Image.Size
	}
	if total > int64(s.imageSettings.MaxTotalSizeMB)*1024*1024 {
		return model.ClipboardEntry{}, ErrClipboardImageQuota
	}
	f, err := os.CreateTemp(s.imageDir, ".image-*.tmp")
	if err != nil {
		return model.ClipboardEntry{}, err
	}
	defer s.removeImage(filepath.Base(f.Name()))
	defer f.Close()
	if _, err := f.Write(encoded.Bytes()); err != nil {
		return model.ClipboardEntry{}, err
	}
	if err := f.Sync(); err != nil {
		return model.ClipboardEntry{}, err
	}
	if err := f.Close(); err != nil {
		return model.ClipboardEntry{}, err
	}
	name := entry.ID + ".png"
	if err := os.Rename(f.Name(), filepath.Join(s.imageDir, name)); err != nil {
		return model.ClipboardEntry{}, err
	}
	if err := s.commit(next); err != nil {
		s.removeImage(name)
		return model.ClipboardEntry{}, err
	}
	return entry, nil
}

// Hold the lock through opening the file so concurrent deletion cannot replace
// the referenced path before the reader has acquired its handle.
func (s *ClipboardService) OpenImage(id string) (*os.File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, entry := range s.entries {
		if entry.ID == id && entry.Type == "image" {
			root, err := os.OpenRoot(s.imageDir)
			if err != nil {
				return nil, err
			}
			defer root.Close()
			return root.Open(entry.ID + ".png")
		}
	}
	return nil, ErrClipboardNotFound
}

func (s *ClipboardService) validStoredImage(entry model.ClipboardEntry) bool {
	parsed, err := uuid.Parse(entry.ID)
	if err != nil || parsed.String() != entry.ID || entry.Text != "" || entry.Image.MimeType != "image/png" || entry.Image.Size <= 0 || entry.Image.Width <= 0 || entry.Image.Height <= 0 || entry.Image.URL != "/api/clipboard/"+entry.ID+"/image" {
		return false
	}
	path := filepath.Join(s.imageDir, entry.ID+".png")
	stat, err := os.Lstat(path)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() != entry.Image.Size {
		return false
	}
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	dim, format, err := image.DecodeConfig(f)
	return err == nil && format == "png" && dim.Width == entry.Image.Width && dim.Height == entry.Image.Height
}

func (s *ClipboardService) removeImage(name string) {
	if err := os.Remove(filepath.Join(s.imageDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		slog.Warn("清理剪贴板图片失败", "event", "clipboard.image_cleanup_failed", "error", err)
	}
}

func (s *ClipboardService) cleanupOrphanImages() {
	retained := make(map[string]bool)
	for _, entry := range s.entries {
		if entry.Type == "image" {
			retained[entry.ID+".png"] = true
		}
	}
	files, err := os.ReadDir(s.imageDir)
	if err != nil {
		slog.Warn("检查剪贴板图片失败", "event", "clipboard.image_cleanup_failed", "error", err)
		return
	}
	for _, file := range files {
		name := file.Name()
		_, idErr := uuid.Parse(strings.TrimSuffix(name, ".png"))
		owned := (strings.HasSuffix(name, ".png") && idErr == nil) || (strings.HasPrefix(name, ".image-") && strings.HasSuffix(name, ".tmp"))
		if !file.IsDir() && owned && !retained[name] {
			s.removeImage(name)
		}
	}
}
