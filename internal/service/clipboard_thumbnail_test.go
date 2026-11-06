package service

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestThumbnailDimensionsAndTransparency(t *testing.T) {
	for _, shape := range []struct{ w, h, wantW, wantH int }{
		{640, 320, 320, 160}, {100, 1000, 32, 320}, {1, 1000, 1, 320}, {10, 20, 10, 20},
	} {
		original := image.NewNRGBA(image.Rect(5, 7, 5+shape.w, 7+shape.h))
		for y := 7; y < 7+shape.h; y++ {
			for x := 5; x < 5+shape.w; x++ {
				original.SetNRGBA(x, y, color.NRGBA{R: 255, A: 128})
			}
		}
		data, err := encodeThumbnail(original)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if decoded.Bounds().Dx() != shape.wantW || decoded.Bounds().Dy() != shape.wantH {
			t.Fatalf("incorrect aspect ratio for %+v: %v", shape, decoded.Bounds())
		}
		if _, _, _, a := decoded.At(0, 0).RGBA(); a != 128*257 {
			t.Fatal("thumbnail lost transparency")
		}
	}
}

func TestClipboardThumbnailPreservesOriginalAndRecoversAfterRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.CreateImage(bytes.NewReader(imageFixture(t, "png", 512)))
	if err != nil {
		t.Fatal(err)
	}
	check := func(s *ClipboardService) {
		t.Helper()
		data, err := s.Thumbnail(entry.ID)
		if err != nil {
			t.Fatal(err)
		}
		dim, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil || dim.Width != 320 || dim.Height != 320 || int64(len(data)) >= entry.Image.Size {
			t.Fatalf("thumbnail not reduced: %+v %d %v", dim, len(data), err)
		}
		original, err := s.OpenImage(entry.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer original.Close()
		dim, err = png.DecodeConfig(original)
		if err != nil || dim.Width != 512 || dim.Height != 512 {
			t.Fatalf("original changed: %+v %v", dim, err)
		}
	}
	check(s)
	reopened, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	check(reopened)
	if err := reopened.Delete(entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Thumbnail(entry.ID); !errors.Is(err, ErrClipboardNotFound) {
		t.Fatalf("deleted thumbnail accessible: %v", err)
	}
	if len(reopened.thumbnails) != 0 {
		t.Fatal("deleted thumbnail remains in memory")
	}
}
