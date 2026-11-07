package config

import "testing"

func TestAccessPasswordSettings(t *testing.T) {
	root := t.TempDir()
	path := putConfig(t, root, "auth:\n  password: yaml-password\n")
	for _, value := range []string{"", "env-password", "短口令测试"} {
		cfg, err := loadSettings(path, root, root, envMap(map[string]string{"GOTHROUGH_ACCESS_PASSWORD": value}))
		if err != nil || cfg.Auth.Password != value {
			t.Fatalf("override failed: %v", err)
		}
	}
	if cfg, err := loadSettings(path, root, root, envMap(nil)); err != nil || cfg.Auth.Password != "yaml-password" {
		t.Fatal("YAML password not loaded")
	}
	for _, value := range []string{"short", "        "} {
		if _, err := loadSettings(path, root, root, envMap(map[string]string{"GOTHROUGH_ACCESS_PASSWORD": value})); err == nil {
			t.Fatal("accepted invalid password")
		}
	}
}

func TestTrustedProxySettings(t *testing.T) {
	root := t.TempDir()
	for _, value := range []string{`["127.0.0.1", "::1", "10.0.0.0/8"]`, `["invalid"]`, `["10.0.0.1/99"]`} {
		path := putConfig(t, root, "auth:\n  trusted_proxies: "+value+"\n")
		cfg, err := loadSettings(path, root, root, envMap(nil))
		if value == `["127.0.0.1", "::1", "10.0.0.0/8"]` {
			if err != nil || len(cfg.Auth.TrustedProxies) != 3 {
				t.Fatalf("valid proxies rejected: %v", err)
			}
		} else if err == nil {
			t.Fatalf("invalid proxies accepted: %s", value)
		}
	}
}
