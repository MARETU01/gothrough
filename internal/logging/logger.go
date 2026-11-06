package logging

import (
	"context"
	"io"
	"log/slog"
	"sync"

	"github.com/MARETU01/gothrough/internal/config"
)

type loggerKey struct{}

func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey{}).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// New always writes to the console. Optional files use the same formatter;
// runtime file failures are reported once per failure episode to the console.
func New(settings config.LoggingSettings, console io.Writer) (*slog.Logger, io.Closer, error) {
	if err := settings.Validate(); err != nil {
		return nil, nil, err
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(settings.Level)); err != nil {
		return nil, nil, err
	}
	makeHandler := func(out io.Writer, level slog.Level) slog.Handler {
		options := &slog.HandlerOptions{Level: level}
		if settings.Format == "json" {
			return slog.NewJSONHandler(out, options)
		}
		return slog.NewTextHandler(out, options)
	}
	var out io.Writer = console
	var closer io.Closer
	if settings.File.Enabled {
		file, err := newRotatingWriter(settings.File.Path, int64(settings.File.MaxSizeMB)*1024*1024, settings.File.MaxBackups)
		if err != nil {
			return nil, nil, err
		}
		both := &consoleAndFile{console: console, file: file, fallback: slog.New(makeHandler(console, slog.LevelError))}
		out, closer = both, both
	}
	return slog.New(makeHandler(out, level)), closer, nil
}

type consoleAndFile struct {
	mu       sync.Mutex
	console  io.Writer
	file     io.WriteCloser
	fallback *slog.Logger
	reported bool
}

func (w *consoleAndFile) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n, err := w.console.Write(data)
	fileN, fileErr := w.file.Write(data)
	if fileErr == nil && fileN != len(data) {
		fileErr = io.ErrShortWrite
	}
	if fileErr != nil {
		if !w.reported {
			w.fallback.Error("日志文件写入失败，日志仍输出到控制台", "event", "logging.file_failed", "error", fileErr)
		}
		w.reported = true
	} else {
		w.reported = false
	}
	if err != nil {
		return n, err
	}
	if n != len(data) {
		return n, io.ErrShortWrite
	}
	return len(data), nil
}

func (w *consoleAndFile) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	err := w.file.Close()
	if err != nil {
		w.fallback.Error("关闭日志文件失败", "event", "logging.close_failed", "error", err)
	}
	return err
}
