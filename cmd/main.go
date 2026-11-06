package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/logging"
	"github.com/MARETU01/gothrough/internal/router"
	"github.com/MARETU01/gothrough/internal/service"
)

func main() {
	if err := run(); err != nil {
		os.Exit(1)
	}
}

func run() (runErr error) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	var closer io.Closer
	defer func() {
		if runErr != nil {
			slog.Error("服务启动或运行失败", "event", "server.failed", "error", runErr)
		}
		if closer != nil {
			runErr = errors.Join(runErr, closer.Close())
		}
	}()
	configPath := flag.String("config", "", "YAML config path (or GOTHROUGH_CONFIG)")
	flag.Parse()
	settings, err := config.Load(*configPath)
	if err != nil {
		return err
	}
	logger, closer, err := logging.New(settings.Logging, os.Stdout)
	if err != nil {
		return err
	}
	slog.SetDefault(logger)
	slog.Info("配置已加载", "event", "config.loaded", "source", settings.Source)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return serve(ctx, settings)
}

func serve(ctx context.Context, settings *config.Settings) error {
	if err := config.Init(settings.Storage.DataDir); err != nil {
		return err
	}
	clipboardService, err := service.NewClipboardService(config.ClipboardFolder, settings.Clipboard.Image)
	if err != nil {
		return err
	}
	cleanupCtx, stopCleanup := context.WithCancel(ctx)
	uploadService := service.NewUploadService()
	defer uploadService.Close()
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				uploadService.ExpireIdle(24 * time.Hour)
			case <-cleanupCtx.Done():
				return
			}
		}
	}()
	defer func() { stopCleanup(); <-cleanupDone }()
	uploadHandler := handler.NewUploadHandler(uploadService)
	clipboardHandler := handler.NewClipboardHandler(clipboardService)
	r := router.SetupRouter(uploadHandler, clipboardHandler, settings.Logging, settings.Auth)

	address := settings.Server.Address()
	server := &http.Server{Addr: address, Handler: r,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Minute, IdleTimeout: 90 * time.Second,
		ErrorLog: slog.NewLogLogger(slog.Default().With("event", "server.http_error").Handler(), slog.LevelError)}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	defer listener.Close()
	protocol := "http"
	if settings.Server.TLS.Enabled {
		protocol = "https"
	}
	slog.Info("服务已开始监听", "event", "server.started", "protocol", protocol, "address", listener.Addr().String())
	errorsCh := make(chan error, 1)
	go func() {
		if settings.Server.TLS.Enabled {
			errorsCh <- server.ServeTLS(listener, settings.Server.TLS.CertFile, settings.Server.TLS.KeyFile)
		} else {
			errorsCh <- server.Serve(listener)
		}
	}()
	select {
	case err := <-errorsCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("服务开始关闭", "event", "server.stopping", "grace_period_seconds", 30)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Warn("优雅关闭未完成，正在强制关闭连接", "event", "server.shutdown_timeout", "error", err)
			if closeErr := server.Close(); closeErr != nil {
				slog.Error("关闭 HTTP 连接失败", "event", "server.close_failed", "error", closeErr)
			}
		}
	}
	slog.Info("HTTP 服务已停止", "event", "server.stopped")
	return nil
}
