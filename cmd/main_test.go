package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/logging"
)

type lifecycleCapture struct {
	mu      sync.Mutex
	data    bytes.Buffer
	started chan string
}

func (w *lifecycleCapture) Write(data []byte) (int, error) {
	w.mu.Lock()
	n, err := w.data.Write(data)
	w.mu.Unlock()
	var record struct {
		Event   string `json:"event"`
		Address string `json:"address"`
	}
	if json.Unmarshal(data, &record) == nil && record.Event == "server.started" {
		select {
		case w.started <- record.Address:
		default:
		}
	}
	return n, err
}

func (w *lifecycleCapture) events(t *testing.T) []string {
	t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	var events []string
	for _, line := range bytes.Split(bytes.TrimSpace(w.data.Bytes()), []byte("\n")) {
		var record struct {
			Event string `json:"event"`
		}
		if err := json.Unmarshal(line, &record); err != nil {
			t.Fatalf("invalid JSON log: %v", err)
		}
		events = append(events, record.Event)
	}
	return events
}

func preserveLogger(t *testing.T) {
	t.Helper()
	oldLogger := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(oldLogger)
	})
}

func TestServerShutdownLogsAndSessionCleanup(t *testing.T) {
	preserveLogger(t)
	dir := t.TempDir()
	settings := &config.Settings{Server: config.ServerSettings{Host: "127.0.0.1", Port: 0}, Storage: config.StorageSettings{DataDir: dir}, Logging: config.DefaultLoggingSettings()}
	settings.Logging.Format, settings.Logging.File.Enabled = "json", true
	settings.Logging.File.Path = filepath.Join(dir, "logs", "app.log")
	capture := &lifecycleCapture{started: make(chan string, 1)}
	logger, closer, err := logging.New(settings.Logging, capture)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = closer.Close() })
	slog.SetDefault(logger)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, settings) }()
	finished := false
	t.Cleanup(func() {
		cancel()
		if !finished {
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("server did not stop")
			}
		}
	})
	var address string
	select {
	case address = <-capture.started:
	case err := <-done:
		finished = true
		t.Fatalf("server stopped before startup: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not start")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Post("http://"+address+"/api/upload/init", "application/json", strings.NewReader(`{"filename":"unfinished.txt","total_size":4}`))
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("X-Request-ID") == "" {
		t.Fatal("initialization failed")
	}
	cancel()
	select {
	case err := <-done:
		finished = true
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not finish")
	}
	if err := closer.Close(); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, event := range capture.events(t) {
		seen[event] = true
	}
	for _, event := range []string{"server.started", "server.stopping", "server.stopped", "upload.shutdown_cleanup"} {
		if !seen[event] {
			t.Fatalf("missing lifecycle log %s", event)
		}
	}
	entries, err := os.ReadDir(filepath.Join(dir, "temp_uploads"))
	if err != nil || len(entries) != 0 {
		t.Fatal("shutdown left upload sessions")
	}
	file, err := os.ReadFile(settings.Logging.File.Path)
	if err != nil || !bytes.Contains(file, []byte("server.stopped")) {
		t.Fatal("shutdown log not persisted")
	}
}

func TestBindFailureStopsBackgroundCleanup(t *testing.T) {
	preserveLogger(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	settings := &config.Settings{Server: config.ServerSettings{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port}, Storage: config.StorageSettings{DataDir: t.TempDir()}, Logging: config.DefaultLoggingSettings()}
	capture := &lifecycleCapture{started: make(chan string, 1)}
	settings.Logging.Format = "json"
	logger, _, err := logging.New(settings.Logging, capture)
	if err != nil {
		t.Fatal(err)
	}
	slog.SetDefault(logger)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- serve(ctx, settings) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected bind failure")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup goroutine blocked bind failure")
	}
	for _, event := range capture.events(t) {
		if event == "server.started" {
			t.Fatal("logged startup before successful bind")
		}
	}
}
