package service

import (
	"bytes"
	"image"
	"image/png"

	"github.com/MARETU01/gothrough/internal/config"
)

const thumbnailEdge = 320

// Thumbnails are derived, bounded in-memory data. Backups and image quotas
// continue to refer only to the original PNG files and committed history.
func encodeThumbnail(source image.Image) ([]byte, error) {
	bounds := source.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w > thumbnailEdge || h > thumbnailEdge {
		if w >= h {
			h = max(1, h*thumbnailEdge/w)
			w = thumbnailEdge
		} else {
			w = max(1, w*thumbnailEdge/h)
			h = thumbnailEdge
		}
		resized := image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := range h {
			for x := range w {
				resized.Set(x, y, source.At(bounds.Min.X+(2*x+1)*bounds.Dx()/(2*w), bounds.Min.Y+(2*y+1)*bounds.Dy()/(2*h)))
			}
		}
		source = resized
	}
	var out bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := encoder.Encode(&out, source); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// Rebuild old entries lazily after restart. Serialize cache misses to avoid
// decoding many full-size images at once; publishing shares the decoder slot.
func (s *ClipboardService) Thumbnail(id string) ([]byte, error) {
	s.mu.RLock()
	cached := s.thumbnails[id]
	s.mu.RUnlock()
	if cached != nil {
		return cached, nil
	}
	s.thumbnailMu.Lock()
	defer s.thumbnailMu.Unlock()
	// Another cache miss may have finished while this request waited.
	s.mu.RLock()
	cached = s.thumbnails[id]
	s.mu.RUnlock()
	if cached != nil {
		return cached, nil
	}
	select {
	case s.imageSlot <- struct{}{}:
		defer func() { <-s.imageSlot }()
	default:
		return nil, ErrBusy
	}
	f, err := s.OpenImage(id)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	dim, err := png.DecodeConfig(f)
	if err != nil || dim.Width <= 0 || dim.Height <= 0 || int64(dim.Width) > config.MaxClipboardImagePixels/int64(dim.Height) {
		return nil, ErrClipboardImage
	}
	if _, err := f.Seek(0, 0); err != nil {
		return nil, err
	}
	decoded, err := png.Decode(f)
	if err != nil {
		return nil, err
	}
	data, err := encodeThumbnail(decoded)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range s.entries {
		if entry.ID == id && entry.Type == "image" {
			s.thumbnails[id] = data
			return data, nil
		}
	}
	return nil, ErrClipboardNotFound
}
