package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoggingSettingsDefaultsAndOverrides(t *testing.T) {
	root := t.TempDir()
	path := putConfig(t, root, "storage:\n  data_dir: ..\nlogging:\n  level: debug\n  format: json\n  access_log: false\n  file:\n    enabled: true\n")
	cfg, err := loadSettings(path, root, root, envMap(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Logging.Level != "debug" || cfg.Logging.Format != "json" || cfg.Logging.AccessLog || cfg.Logging.LogChunks || cfg.Logging.LogPolling {
		t.Fatalf("YAML: %+v", cfg.Logging)
	}
	if cfg.Logging.File.Path != filepath.Join(root, "logs", "gothrough.log") || cfg.Logging.File.MaxSizeMB != 10 || cfg.Logging.File.MaxBackups != 5 {
		t.Fatalf("file defaults: %+v", cfg.Logging.File)
	}
	if _, err := os.Stat(filepath.Dir(cfg.Logging.File.Path)); !os.IsNotExist(err) {
		t.Fatal("configuration loading created log directories")
	}
	cfg, err = loadSettings(path, root, root, envMap(map[string]string{
		"GOTHROUGH_LOG_LEVEL": " WARN ", "GOTHROUGH_LOG_FORMAT": "text", "GOTHROUGH_ACCESS_LOG": "true",
		"GOTHROUGH_LOG_POLLING": "true", "GOTHROUGH_LOG_CHUNKS": "true", "GOTHROUGH_LOG_FILE_ENABLED": "false",
		"GOTHROUGH_LOG_FILE_PATH": "custom/app.log", "GOTHROUGH_LOG_FILE_MAX_SIZE_MB": "3", "GOTHROUGH_LOG_FILE_MAX_BACKUPS": "2",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Logging.Level != "warn" || cfg.Logging.Format != "text" || !cfg.Logging.AccessLog || !cfg.Logging.LogChunks || !cfg.Logging.LogPolling || cfg.Logging.File.Enabled {
		t.Fatalf("env override: %+v", cfg.Logging)
	}
	if cfg.Logging.File.Path != filepath.Join(root, "custom", "app.log") || cfg.Logging.File.MaxSizeMB != 3 || cfg.Logging.File.MaxBackups != 2 {
		t.Fatal("file overrides not applied")
	}
}

func TestInvalidLoggingSettings(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"level": {"GOTHROUGH_LOG_LEVEL": "trace"}, "format": {"GOTHROUGH_LOG_FORMAT": "xml"},
		"empty level": {"GOTHROUGH_LOG_LEVEL": ""}, "empty format": {"GOTHROUGH_LOG_FORMAT": ""},
		"access": {"GOTHROUGH_ACCESS_LOG": "maybe"}, "polling": {"GOTHROUGH_LOG_POLLING": ""},
		"chunks": {"GOTHROUGH_LOG_CHUNKS": "maybe"}, "file enabled": {"GOTHROUGH_LOG_FILE_ENABLED": "maybe"},
		"empty path":   {"GOTHROUGH_LOG_FILE_ENABLED": "true", "GOTHROUGH_LOG_FILE_PATH": " "},
		"size invalid": {"GOTHROUGH_LOG_FILE_MAX_SIZE_MB": "bad"}, "size zero": {"GOTHROUGH_LOG_FILE_MAX_SIZE_MB": "0"},
		"size high": {"GOTHROUGH_LOG_FILE_MAX_SIZE_MB": "1025"}, "backups invalid": {"GOTHROUGH_LOG_FILE_MAX_BACKUPS": "bad"},
		"backups zero": {"GOTHROUGH_LOG_FILE_MAX_BACKUPS": "0"}, "backups high": {"GOTHROUGH_LOG_FILE_MAX_BACKUPS": "101"},
		"temporary log": {"GOTHROUGH_LOG_FILE_ENABLED": "true", "GOTHROUGH_LOG_FILE_PATH": "temp_uploads/session/app.log"},
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			if _, err := loadSettings("", root, root, envMap(values)); err == nil {
				t.Fatal("accepted invalid logging settings")
			}
		})
	}
}
