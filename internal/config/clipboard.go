package config

import "fmt"

type ClipboardSettings struct {
	Image ClipboardImageSettings `yaml:"image"`
}
type ClipboardImageSettings struct {
	Enabled        bool `yaml:"enabled" json:"enabled"`
	MaxSizeMB      int  `yaml:"max_size_mb" json:"max_size_mb"`
	MaxPixels      int  `yaml:"max_pixels" json:"max_pixels"`
	MaxTotalSizeMB int  `yaml:"max_total_size_mb" json:"max_total_size_mb"`
}

func DefaultClipboardImageSettings() ClipboardImageSettings {
	return ClipboardImageSettings{Enabled: true, MaxSizeMB: 10, MaxPixels: 20000000, MaxTotalSizeMB: 200}
}

func (s ClipboardImageSettings) Validate() error {
	if s.MaxSizeMB < 1 || s.MaxSizeMB > 50 || s.MaxPixels < 1 || s.MaxPixels > 40000000 || s.MaxTotalSizeMB < s.MaxSizeMB || s.MaxTotalSizeMB > 10240 {
		return fmt.Errorf("clipboard.image: max_size_mb 必须在 1–50，max_pixels 在 1–40000000，max_total_size_mb 在 max_size_mb–10240 之间")
	}
	return nil
}
