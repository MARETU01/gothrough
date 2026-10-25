package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/router"
	"github.com/MARETU01/gothrough/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "", "YAML config path (or GOTHROUGH_CONFIG)")
	enableTLS := flag.Bool("tls", false, "override TLS enablement; environment variables take precedence")
	flag.Parse()
	var legacyTLS *bool
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "tls" {
			legacyTLS = enableTLS
		}
	})
	settings, err := config.Load(*configPath, config.Overrides{TLS: legacyTLS})
	if err != nil {
		return err
	}
	log.Printf("配置来源: %s", settings.Source)
	config.Init()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	uploadService := service.NewUploadService()
	defer uploadService.Close()
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				uploadService.ExpireIdle(24 * time.Hour)
			case <-ctx.Done():
				return
			}
		}
	}()
	uploadHandler := handler.NewUploadHandler(uploadService)
	r := router.SetupRouter(uploadHandler)

	address := settings.Server.Address()
	server := &http.Server{Addr: address, Handler: r,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Minute, IdleTimeout: 90 * time.Second}
	errorsCh := make(chan error, 1)
	go func() {
		if settings.Server.TLS.Enabled {
			log.Printf("启动 HTTPS 文件传输服务器，监听 %s", address)
			errorsCh <- server.ListenAndServeTLS(settings.Server.TLS.CertFile, settings.Server.TLS.KeyFile)
		} else {
			log.Printf("启动 HTTP 文件传输服务器，监听 %s", address)
			errorsCh <- server.ListenAndServe()
		}
	}()
	select {
	case err := <-errorsCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
		}
	}
	return nil
}
