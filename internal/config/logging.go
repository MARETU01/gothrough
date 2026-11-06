package config

import (
	"fmt"
	"strings"
)

type LoggingSettings struct {
	Level      string          `yaml:"level"`
	Format     string          `yaml:"format"`
	AccessLog  bool            `yaml:"access_log"`
	LogPolling bool            `yaml:"log_polling"`
	LogChunks  bool            `yaml:"log_chunks"`
	File       LogFileSettings `yaml:"file"`
}

type LogFileSettings struct {
	Enabled    bool   `yaml:"enabled"`
	Path       string `yaml:"path"`
	MaxSizeMB  int    `yaml:"max_size_mb"`
	MaxBackups int    `yaml:"max_backups"`
}

func DefaultLoggingSettings() LoggingSettings {
	return LoggingSettings{Level: "info", Format: "text", AccessLog: true,
		File: LogFileSettings{Path: "logs/gothrough.log", MaxSizeMB: 10, MaxBackups: 5}}
}

func (s LoggingSettings) Validate() error {
	switch s.Level {
	case "debug", "info", "warn", "error":
	default:
		return fmt.Errorf("logging.level 必须为 debug、info、warn 或 error")
	}
	if s.Format != "text" && s.Format != "json" {
		return fmt.Errorf("logging.format 必须为 text 或 json")
	}
	if s.File.MaxSizeMB < 1 || s.File.MaxSizeMB > 1024 {
		return fmt.Errorf("logging.file.max_size_mb 必须在 1 到 1024 之间")
	}
	if s.File.MaxBackups < 1 || s.File.MaxBackups > 100 {
		return fmt.Errorf("logging.file.max_backups 必须在 1 到 100 之间")
	}
	if s.File.Enabled && strings.TrimSpace(s.File.Path) == "" {
		return fmt.Errorf("启用日志文件时 logging.file.path 不能为空")
	}
	return nil
}
