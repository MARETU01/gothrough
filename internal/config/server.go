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
	Server  ServerSettings  `yaml:"server"`
	Storage StorageSettings `yaml:"storage"`
	Source  string          `yaml:"-"`
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
	cfg := &Settings{Server: ServerSettings{Host: "0.0.0.0", Port: 8080}, Source: "内置默认值"}
	cfg.Storage.DataDir = exeDir
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
