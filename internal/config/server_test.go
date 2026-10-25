package config

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func envMap(values map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) { value, ok := values[key]; return value, ok }
}

func putConfig(t *testing.T, dir, content string) string {
	t.Helper()
	path := filepath.Join(dir, "config", "config.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSettingsDefaultsAndDiscovery(t *testing.T) {
	root := t.TempDir()
	exeDir := filepath.Join(root, "bin")
	cwd := filepath.Join(root, "work")
	cfg, err := loadSettings("", exeDir, cwd, envMap(nil), Overrides{})
	if err != nil || cfg.Server.Address() != "0.0.0.0:8080" || cfg.Server.TLS.Enabled {
		t.Fatalf("defaults: %v %v", cfg, err)
	}
	cwdPath := putConfig(t, cwd, "server:\n  port: 9001\n")
	cfg, err = loadSettings("", exeDir, cwd, envMap(nil), Overrides{})
	if err != nil || cfg.Source != cwdPath || cfg.Server.Port != 9001 {
		t.Fatalf("cwd config: %v %v", cfg, err)
	}
	exePath := putConfig(t, exeDir, "server:\n  port: 9002\n")
	cfg, err = loadSettings("", exeDir, cwd, envMap(nil), Overrides{})
	if err != nil || cfg.Source != exePath || cfg.Server.Port != 9002 {
		t.Fatalf("exe config: %v %v", cfg, err)
	}
	cfg, err = loadSettings(cwdPath, exeDir, cwd, envMap(map[string]string{"GOTHROUGH_CONFIG": exePath}), Overrides{})
	if err != nil || cfg.Server.Port != 9001 {
		t.Fatalf("explicit config: %v %v", cfg, err)
	}
	cfg, err = loadSettings("", exeDir, cwd, envMap(map[string]string{"GOTHROUGH_CONFIG": cwdPath}), Overrides{})
	if err != nil || cfg.Server.Port != 9001 {
		t.Fatalf("environment config: %v %v", cfg, err)
	}
}

func TestEnvironmentOverridesFileAndLegacyFlag(t *testing.T) {
	root := t.TempDir()
	path := putConfig(t, root, "server:\n  host: localhost\n  port: 8443\n  tls:\n    enabled: true\n    cert_file: missing.crt\n    key_file: missing.key\n")
	legacy := true
	cfg, err := loadSettings(path, root, root, envMap(map[string]string{
		"GOTHROUGH_HOST": "::1", "GOTHROUGH_PORT": "9090", "GOTHROUGH_TLS_ENABLED": "false",
		"GOTHROUGH_TLS_CERT_FILE": "certs/env.crt", "GOTHROUGH_TLS_KEY_FILE": "certs/env.key",
	}), Overrides{TLS: &legacy})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.Address() != "[::1]:9090" || cfg.Server.TLS.Enabled {
		t.Fatalf("environment not applied: %+v", cfg)
	}
	if cfg.Server.TLS.CertFile != filepath.Join(root, "config", "certs", "env.crt") {
		t.Fatal(cfg.Server.TLS.CertFile)
	}
	if cfg.Server.TLS.KeyFile != filepath.Join(root, "config", "certs", "env.key") {
		t.Fatal(cfg.Server.TLS.KeyFile)
	}
	legacy = false
	if _, err := loadSettings(path, root, root, envMap(nil), Overrides{TLS: &legacy}); err != nil {
		t.Fatalf("explicit legacy false: %v", err)
	}
	cfg, err = loadSettings("", root, root, envMap(map[string]string{"GOTHROUGH_PORT": "8181", "GOTHROUGH_TLS_ENABLED": "false"}), Overrides{})
	if err != nil || cfg.Server.Port != 8181 {
		t.Fatalf("env only: %+v %v", cfg, err)
	}
}

func TestInvalidSettings(t *testing.T) {
	for name, values := range map[string]map[string]string{
		"port text": {"GOTHROUGH_PORT": "http"}, "port empty": {"GOTHROUGH_PORT": ""},
		"port zero": {"GOTHROUGH_PORT": "0"}, "port high": {"GOTHROUGH_PORT": "65536"},
		"port negative": {"GOTHROUGH_PORT": "-1"}, "bool invalid": {"GOTHROUGH_TLS_ENABLED": "yes"},
		"bool empty": {"GOTHROUGH_TLS_ENABLED": ""}, "host URL": {"GOTHROUGH_HOST": "http://localhost"},
		"host with port": {"GOTHROUGH_HOST": "localhost:8080"}, "host whitespace": {"GOTHROUGH_HOST": "local host"},
		"TLS missing files": {"GOTHROUGH_TLS_ENABLED": "true"},
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			if _, err := loadSettings("", root, root, envMap(values), Overrides{}); err == nil {
				t.Fatal("accepted invalid settings")
			}
		})
	}
	for name, content := range map[string]string{
		"unknown field": "server:\n  prot: 9000\n", "wrong type": "server:\n  port: nope\n",
		"multiple documents": "server:\n  port: 8080\n---\nserver:\n  port: 9000\n", "empty": "",
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			path := putConfig(t, root, content)
			if _, err := loadSettings(path, root, root, envMap(nil), Overrides{}); err == nil {
				t.Fatal("accepted invalid YAML")
			}
		})
	}
	root := t.TempDir()
	if _, err := loadSettings("missing.yaml", root, root, envMap(nil), Overrides{}); err == nil {
		t.Fatal("explicit missing file silently ignored")
	}
	if _, err := loadSettings("", root, root, envMap(map[string]string{"GOTHROUGH_CONFIG": "missing.yaml"}), Overrides{}); err == nil {
		t.Fatal("environment missing file silently ignored")
	}
}

func TestTLSCertificates(t *testing.T) {
	root := t.TempDir()
	certPath, keyPath := filepath.Join(root, "server.crt"), filepath.Join(root, "server.key")
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	cert, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyData, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert}), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyData}), 0600); err != nil {
		t.Fatal(err)
	}
	values := map[string]string{"GOTHROUGH_TLS_ENABLED": "true", "GOTHROUGH_TLS_CERT_FILE": certPath, "GOTHROUGH_TLS_KEY_FILE": keyPath, "GOTHROUGH_PORT": "8443"}
	cfg, err := loadSettings("", root, root, envMap(values), Overrides{})
	if err != nil || !cfg.Server.TLS.Enabled || cfg.Server.Port != 8443 {
		t.Fatalf("valid TLS: %v %v", cfg, err)
	}
	pair, err := tls.LoadX509KeyPair(cfg.Server.TLS.CertFile, cfg.Server.TLS.KeyFile)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil {
			t.Error("request was not TLS")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatal(response.StatusCode)
	}
	values["GOTHROUGH_TLS_KEY_FILE"] = certPath
	if _, err := loadSettings("", root, root, envMap(values), Overrides{}); err == nil || !strings.Contains(err.Error(), "证书") {
		t.Fatalf("invalid key accepted: %v", err)
	}
}
