package config

import (
	"bytes"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/goccy/go-yaml"
)

type Settings struct {
	Auth      AuthSettings      `yaml:"auth"`
	Clipboard ClipboardSettings `yaml:"clipboard"`
	Server    ServerSettings    `yaml:"server"`
	Storage   StorageSettings   `yaml:"storage"`
	Logging   LoggingSettings   `yaml:"logging"`
	Source    string            `yaml:"-"`
}

type AuthSettings struct {
	Password       string   `yaml:"password"`
	TrustedProxies []string `yaml:"trusted_proxies"`
}

type StorageSettings struct {
	DataDir string `yaml:"data_dir"`
}

type ServerSettings struct {
	Host string      `yaml:"host"`
	Port int         `yaml:"port"`
	TLS  TLSSettings `yaml:"tls"`
}

type TLSSettings struct {
	Enabled  bool   `yaml:"enabled"`
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

func (s ServerSettings) Address() string { return net.JoinHostPort(s.Host, strconv.Itoa(s.Port)) }

// Load is read-only: config and certificates are validated before initializing
// storage, so a bad configuration never triggers temporary-upload cleanup.
func Load(path string) (*Settings, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("获取可执行文件路径失败: %w", err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("获取工作目录失败: %w", err)
	}
	return loadSettings(path, filepath.Dir(exe), cwd, os.LookupEnv)
}

func loadSettings(path, exeDir, cwd string, lookup func(string) (string, bool)) (*Settings, error) {
	cfg := &Settings{Server: ServerSettings{Host: "0.0.0.0", Port: 9815}, Source: "内置默认值"}
	cfg.Storage.DataDir = exeDir
	cfg.Logging = DefaultLoggingSettings()
	cfg.Clipboard.Image = DefaultClipboardImageSettings()
	if path == "" {
		path, _ = lookup("GOTHROUGH_CONFIG")
	}
	explicit := path != ""
	if !explicit {
		for _, candidate := range []string{filepath.Join(exeDir, "config", "config.yaml"), filepath.Join(cwd, "config", "config.yaml")} {
			_, err := os.Stat(candidate)
			if err == nil {
				path = candidate
				break
			}
			if !errors.Is(err, os.ErrNotExist) {
				return nil, fmt.Errorf("检查配置 %s: %w", candidate, err)
			}
		}
	}
	base := cwd
	if path != "" {
		if !filepath.IsAbs(path) {
			path = filepath.Join(cwd, path)
		}
		path = filepath.Clean(path)
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("读取配置 %s: %w", path, err)
		}
		decoder := yaml.NewDecoder(bytes.NewReader(data), yaml.Strict())
		if err := decoder.Decode(cfg); err != nil {
			return nil, fmt.Errorf("解析配置 %s: %w", path, err)
		}
		var extra any
		if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
			return nil, fmt.Errorf("配置 %s 只允许一个 YAML 文档", path)
		}
		cfg.Source = path
		base = filepath.Dir(path)
	}
	if value, ok := lookup("GOTHROUGH_HOST"); ok {
		cfg.Server.Host = value
	}
	if value, ok := lookup("GOTHROUGH_ACCESS_PASSWORD"); ok {
		cfg.Auth.Password = value
	}
	if cfg.Auth.Password != "" && (len(cfg.Auth.Password) < 8 || len(cfg.Auth.Password) > 256 || strings.TrimSpace(cfg.Auth.Password) == "") {
		return nil, fmt.Errorf("访问口令必须为 8 到 256 字节，或留空以关闭验证")
	}
	for _, proxy := range cfg.Auth.TrustedProxies {
		if net.ParseIP(proxy) == nil {
			if _, _, err := net.ParseCIDR(proxy); err != nil {
				return nil, fmt.Errorf("auth.trusted_proxies 必须包含有效的 IP 或 CIDR: %s", proxy)
			}
		}
	}
	if value, ok := lookup("GOTHROUGH_PORT"); ok {
		port, err := strconv.Atoi(value)
		if err != nil {
			return nil, fmt.Errorf("GOTHROUGH_PORT 必须是整数")
		}
		cfg.Server.Port = port
	}
	if value, ok := lookup("GOTHROUGH_TLS_ENABLED"); ok {
		enabled, err := strconv.ParseBool(value)
		if err != nil {
			return nil, fmt.Errorf("GOTHROUGH_TLS_ENABLED 必须为 true 或 false")
		}
		cfg.Server.TLS.Enabled = enabled
	}
	if value, ok := lookup("GOTHROUGH_TLS_CERT_FILE"); ok {
		cfg.Server.TLS.CertFile = value
	}
	if value, ok := lookup("GOTHROUGH_TLS_KEY_FILE"); ok {
		cfg.Server.TLS.KeyFile = value
	}
	if value, ok := lookup("GOTHROUGH_DATA_DIR"); ok {
		cfg.Storage.DataDir = value
	}
	if strings.TrimSpace(cfg.Storage.DataDir) == "" {
		return nil, fmt.Errorf("storage.data_dir / GOTHROUGH_DATA_DIR 不能为空")
	}
	if !filepath.IsAbs(cfg.Storage.DataDir) {
		cfg.Storage.DataDir = filepath.Join(base, cfg.Storage.DataDir)
	}
	cfg.Storage.DataDir = filepath.Clean(cfg.Storage.DataDir)
	for _, binding := range []struct {
		name   string
		target *string
	}{
		{"GOTHROUGH_LOG_LEVEL", &cfg.Logging.Level}, {"GOTHROUGH_LOG_FORMAT", &cfg.Logging.Format},
		{"GOTHROUGH_LOG_FILE_PATH", &cfg.Logging.File.Path},
	} {
		if value, ok := lookup(binding.name); ok {
			*binding.target = value
		}
	}
	for _, binding := range []struct {
		name   string
		target *bool
	}{
		{"GOTHROUGH_ACCESS_LOG", &cfg.Logging.AccessLog}, {"GOTHROUGH_LOG_POLLING", &cfg.Logging.LogPolling},
		{"GOTHROUGH_LOG_CHUNKS", &cfg.Logging.LogChunks}, {"GOTHROUGH_LOG_FILE_ENABLED", &cfg.Logging.File.Enabled},
		{"GOTHROUGH_CLIPBOARD_IMAGE_ENABLED", &cfg.Clipboard.Image.Enabled},
	} {
		if value, ok := lookup(binding.name); ok {
			parsed, err := strconv.ParseBool(value)
			if err != nil {
				return nil, fmt.Errorf("%s 必须为 true 或 false", binding.name)
			}
			*binding.target = parsed
		}
	}
	for _, binding := range []struct {
		name   string
		target *int
	}{
		{"GOTHROUGH_LOG_FILE_MAX_SIZE_MB", &cfg.Logging.File.MaxSizeMB},
		{"GOTHROUGH_LOG_FILE_MAX_BACKUPS", &cfg.Logging.File.MaxBackups},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB", &cfg.Clipboard.Image.MaxSizeMB},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_PIXELS", &cfg.Clipboard.Image.MaxPixels},
		{"GOTHROUGH_CLIPBOARD_IMAGE_MAX_TOTAL_SIZE_MB", &cfg.Clipboard.Image.MaxTotalSizeMB},
	} {
		if value, ok := lookup(binding.name); ok {
			parsed, err := strconv.Atoi(value)
			if err != nil {
				return nil, fmt.Errorf("%s 必须是整数", binding.name)
			}
			*binding.target = parsed
		}
	}
	cfg.Logging.Level = strings.ToLower(strings.TrimSpace(cfg.Logging.Level))
	cfg.Logging.Format = strings.ToLower(strings.TrimSpace(cfg.Logging.Format))
	if err := cfg.Logging.Validate(); err != nil {
		return nil, err
	}
	if err := cfg.Clipboard.Image.Validate(); err != nil {
		return nil, err
	}
	if cfg.Logging.File.Path != "" && !filepath.IsAbs(cfg.Logging.File.Path) {
		cfg.Logging.File.Path = filepath.Join(cfg.Storage.DataDir, cfg.Logging.File.Path)
	}
	if cfg.Logging.File.Enabled {
		tempDir := filepath.Join(cfg.Storage.DataDir, "temp_uploads")
		if rel, err := filepath.Rel(tempDir, cfg.Logging.File.Path); err == nil && (rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))) {
			return nil, fmt.Errorf("日志文件不能保存在临时上传目录中")
		}
	}
	if cfg.Server.Port < 1 || cfg.Server.Port > 65535 {
		return nil, fmt.Errorf("server.port 必须在 1 到 65535 之间")
	}
	host := cfg.Server.Host
	if strings.ContainsAny(host, " /\\\t\r\n[]") || (strings.Contains(host, ":") && net.ParseIP(host) == nil) {
		return nil, fmt.Errorf("server.host 应仅包含主机名或 IP，不含协议、端口或方括号")
	}
	for _, p := range []*string{&cfg.Server.TLS.CertFile, &cfg.Server.TLS.KeyFile} {
		if *p != "" && !filepath.IsAbs(*p) {
			*p = filepath.Clean(filepath.Join(base, *p))
		}
	}
	if cfg.Server.TLS.Enabled {
		if strings.TrimSpace(cfg.Server.TLS.CertFile) == "" || strings.TrimSpace(cfg.Server.TLS.KeyFile) == "" {
			return nil, fmt.Errorf("启用 TLS 时必须配置证书和私钥路径")
		}
		if _, err := tls.LoadX509KeyPair(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile); err != nil {
			return nil, fmt.Errorf("加载 TLS 证书和私钥失败: %w", err)
		}
	}
	return cfg, nil
}
