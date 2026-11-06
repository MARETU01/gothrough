package logging

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/MARETU01/gothrough/internal/config"
)

func records(t *testing.T, data []byte) []map[string]any {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(data))
	var result []map[string]any
	for {
		var record map[string]any
		err := decoder.Decode(&record)
		if errors.Is(err, io.EOF) {
			return result
		}
		if err != nil {
			t.Fatalf("invalid structured log: %v\n%s", err, data)
		}
		result = append(result, record)
	}
}

func TestLevelsAndFormats(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.Format, settings.Level = "json", "warn"
	logger, closer, err := New(settings, &out)
	if err != nil || closer != nil {
		t.Fatalf("console logger: %v", err)
	}
	logger.Debug("debug")
	logger.Info("info")
	logger.Warn("warning")
	logger.Error("error")
	got := records(t, out.Bytes())
	if len(got) != 2 || got[0]["level"] != "WARN" || got[1]["level"] != "ERROR" {
		t.Fatalf("levels: %v", got)
	}
	out.Reset()
	settings.Format, settings.Level = "text", "info"
	logger, _, err = New(settings, &out)
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("started", "event", "server.started")
	if !bytes.Contains(out.Bytes(), []byte("level=INFO")) || !bytes.Contains(out.Bytes(), []byte("event=server.started")) {
		t.Fatalf("text: %s", out.String())
	}
}

func TestConcurrentConsoleAndFileLogs(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.Format, settings.File.Enabled = "json", true
	settings.File.Path = filepath.Join(t.TempDir(), "logs", "app.log")
	logger, closer, err := New(settings, &out)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			for n := 0; n < 10; n++ {
				logger.Info("concurrent", "worker", index, "sequence", n)
			}
		}(i)
	}
	wg.Wait()
	if err := closer.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(settings.File.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, out.Bytes()) || len(records(t, data)) != 160 {
		t.Fatal("console/file records differ or interleave")
	}
}

func TestOptionalFileAndOpenFailure(t *testing.T) {
	var out bytes.Buffer
	settings := config.DefaultLoggingSettings()
	settings.File.Path = filepath.Join(t.TempDir(), "missing", "app.log")
	logger, _, err := New(settings, &out)
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("console only")
	if _, err := os.Stat(filepath.Dir(settings.File.Path)); !os.IsNotExist(err) {
		t.Fatal("disabled file output created directories")
	}
	settings.File.Enabled, settings.File.Path = true, t.TempDir()
	if _, _, err := New(settings, &out); err == nil {
		t.Fatal("accepted directory as log file")
	}
}

type failingFile struct{ err error }

func (f *failingFile) Write(data []byte) (int, error) {
	if f.err != nil {
		return 0, f.err
	}
	return len(data), nil
}
func (f *failingFile) Close() error { return nil }

func TestFileFailureKeepsConsoleAndReportsOnceUntilRecovery(t *testing.T) {
	var out bytes.Buffer
	file := &failingFile{err: errors.New("disk full")}
	w := &consoleAndFile{console: &out, file: file, fallback: slog.New(slog.NewJSONHandler(&out, nil))}
	logger := slog.New(slog.NewJSONHandler(w, nil))
	logger.Info("first")
	logger.Info("second")
	file.err = nil
	logger.Info("recovered")
	file.err = errors.New("disk full again")
	logger.Info("third")
	got := records(t, out.Bytes())
	failures := 0
	for _, record := range got {
		if record["event"] == "logging.file_failed" {
			failures++
		}
	}
	if len(got) != 6 || failures != 2 {
		t.Fatalf("fallback records: %v", got)
	}
}

func TestConsoleFailureDoesNotPreventFileOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	file, err := newRotatingWriter(path, 1024, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	broken := &failingFile{err: errors.New("console unavailable")}
	w := &consoleAndFile{console: broken, file: file, fallback: slog.New(slog.NewJSONHandler(broken, nil))}
	if _, err := w.Write([]byte("{\"event\":\"still.saved\"}\n")); err == nil {
		t.Fatal("console failure was not returned")
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || len(records(t, data)) != 1 {
		t.Fatal("console failure discarded file log")
	}
}
