package service

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"uuid"

	"github.com/MARETU01/gothrough/internal/config"
)

func imageFixture(t *testing.T, format string, size int) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, size, size))
	random := rand.New(rand.NewSource(1))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			im.SetNRGBA(x, y, color.NRGBA{uint8(random.Intn(256)), uint8(random.Intn(256)), uint8(random.Intn(256)), 255})
		}
	}
	var data bytes.Buffer
	var err error
	if format == "jpeg" {
		err = jpeg.Encode(&data, im, nil)
	} else {
		err = png.Encode(&data, im)
	}
	if err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestClipboardImagesPersistNormalizeAndDelete(t *testing.T) {
	for _, format := range []string{"png", "jpeg"} {
		t.Run(format, func(t *testing.T) {
			dir := t.TempDir()
			s, err := NewClipboardService(dir)
			if err != nil {
				t.Fatal(err)
			}
			entry, err := s.CreateImage(bytes.NewReader(imageFixture(t, format, 3)))
			if err != nil {
				t.Fatal(err)
			}
			if entry.Type != "image" || entry.Image.Width != 3 || entry.Image.MimeType != "image/png" || entry.Text != "" {
				t.Fatal(entry)
			}
			f, err := s.OpenImage(entry.ID)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := png.Decode(bytes.NewReader(data)); err != nil || int64(len(data)) != entry.Image.Size {
				t.Fatalf("invalid normalized PNG: %v", err)
			}
			reopened, err := NewClipboardService(dir)
			if err != nil {
				t.Fatal(err)
			}
			if reopened.List()[0] != entry {
				t.Fatal("image metadata lost on restart")
			}
			body, tag := s.Snapshot()
			otherBody, otherTag := reopened.Snapshot()
			if body != otherBody || tag != otherTag {
				t.Fatal("snapshot changed on restart")
			}
			if err := reopened.Delete(entry.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(dir, "images", entry.ID+".png")); !os.IsNotExist(err) {
				t.Fatal("deleted image remains")
			}
			if _, err := reopened.OpenImage(entry.ID); !errors.Is(err, ErrClipboardNotFound) {
				t.Fatal("deleted image accessible")
			}
		})
	}
}

func TestClipboardImageLimitsAndAdmission(t *testing.T) {
	settings := config.DefaultClipboardImageSettings()
	settings.MaxSizeMB = 1
	settings.MaxTotalSizeMB = 1
	s, err := NewClipboardService(t.TempDir(), settings)
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range [][]byte{[]byte("not an image"), []byte(`<svg/>`), imageFixture(t, "png", 2)[:30]} {
		if _, err := s.CreateImage(bytes.NewReader(data)); !errors.Is(err, ErrClipboardImage) {
			t.Fatalf("invalid image accepted: %v", err)
		}
	}
	if _, err := s.CreateImage(bytes.NewReader(make([]byte, 1024*1024+1))); !errors.Is(err, ErrClipboardImageSize) {
		t.Fatal(err)
	}
	data := imageFixture(t, "png", 512)
	if _, err := s.CreateImage(bytes.NewReader(data)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateImage(bytes.NewReader(data)); !errors.Is(err, ErrClipboardImageQuota) {
		t.Fatalf("quota: %v", err)
	}
	// A small JPEG can expand beyond the byte limit when normalized to PNG.
	if _, err := s.CreateImage(bytes.NewReader(imageFixture(t, "jpeg", 650))); !errors.Is(err, ErrClipboardImageSize) {
		t.Fatalf("normalized size: %v", err)
	}
	if len(s.List()) != 1 {
		t.Fatal("quota failure committed an entry")
	}
	s.imageSlot <- struct{}{}
	if _, err := s.CreateImage(bytes.NewReader(data)); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	<-s.imageSlot
	settings.MaxPixels = 1
	s, err = NewClipboardService(t.TempDir(), settings)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateImage(bytes.NewReader(imageFixture(t, "png", 2))); !errors.Is(err, ErrClipboardImageSize) {
		t.Fatal(err)
	}
	settings.Enabled = false
	s, err = NewClipboardService(t.TempDir(), settings)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateImage(bytes.NewReader(data)); !errors.Is(err, ErrClipboardImageDisabled) {
		t.Fatal(err)
	}
}

func TestClipboardImageRollbackAndRecovery(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.CreateImage(bytes.NewReader(imageFixture(t, "png", 2)))
	if err != nil {
		t.Fatal(err)
	}
	originalPath := s.path
	s.path = filepath.Join(dir, "blocked")
	if err := os.Mkdir(s.path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.path, "child"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateImage(bytes.NewReader(imageFixture(t, "png", 2))); err == nil {
		t.Fatal("expected save failure")
	}
	if err := s.Clear(); err == nil {
		t.Fatal("expected clear failure")
	}
	files, err := os.ReadDir(s.imageDir)
	if err != nil || len(files) != 1 || files[0].Name() != entry.ID+".png" {
		t.Fatalf("rollback lost or leaked images: %v %v", files, err)
	}
	s.path = originalPath
	orphan := filepath.Join(s.imageDir, uuid.NewV7().String()+".png")
	if err := os.WriteFile(orphan, []byte("orphan"), 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("orphan remains")
	}
	if err := reopened.Clear(); err != nil {
		t.Fatal(err)
	}
	files, err = os.ReadDir(s.imageDir)
	if err != nil || len(files) != 0 {
		t.Fatal("clear left image files")
	}
}

func TestClipboardImageRetentionAndMissingFile(t *testing.T) {
	dir := t.TempDir()
	s, err := NewClipboardService(dir)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := s.CreateImage(bytes.NewReader(imageFixture(t, "png", 2)))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.imageDir, entry.ID+".png")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := NewClipboardService(dir); err == nil {
		t.Fatal("missing image accepted silently")
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < ClipboardMaxEntries; i++ {
		if _, err := s.Create("text"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("evicted image remains")
	}
}
