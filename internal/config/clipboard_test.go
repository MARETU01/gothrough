package config

import "testing"

func TestClipboardImageConfiguration(t *testing.T) {
	dir := t.TempDir()
	path := putConfig(t, dir, "clipboard:\n  image:\n    enabled: false\n    max_size_mb: 2\n    max_total_size_mb: 4\n")
	cfg, err := loadSettings(path, dir, dir, envMap(nil))
	if err != nil || cfg.Clipboard.Image.Enabled || cfg.Clipboard.Image.MaxSizeMB != 2 || cfg.Clipboard.Image.MaxPixels != 20000000 {
		t.Fatalf("settings: %v %v", cfg, err)
	}
	cfg, err = loadSettings(path, dir, dir, envMap(map[string]string{"GOTHROUGH_CLIPBOARD_IMAGE_ENABLED": "true", "GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB": "3", "GOTHROUGH_CLIPBOARD_IMAGE_MAX_PIXELS": "1234"}))
	if err != nil || !cfg.Clipboard.Image.Enabled || cfg.Clipboard.Image.MaxSizeMB != 3 || cfg.Clipboard.Image.MaxPixels != 1234 {
		t.Fatalf("override: %v %v", cfg, err)
	}
	for _, values := range []map[string]string{
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB": "0"},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB": "51"},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_PIXELS": "40000001"},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_TOTAL_SIZE_MB": "1"},
		{"GOTHROUGH_CLIPBOARD_IMAGE_ENABLED": "invalid"},
	} {
		if _, err := loadSettings(path, dir, dir, envMap(values)); err == nil {
			t.Fatalf("invalid settings accepted: %v", values)
		}
	}
}
