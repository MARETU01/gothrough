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
	enableTLS := flag.Bool("tls", false, "enable https tls server, use -tls=true to open")
	flag.Parse()
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

	address := config.ServerPort
	if *enableTLS {
		address = config.ServerPortTLS
	}
	server := &http.Server{Addr: address, Handler: r,
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Minute, IdleTimeout: 90 * time.Second}
	errorsCh := make(chan error, 1)
	go func() {
		log.Printf("启动文件传输服务器，端口 %s", address)
		if *enableTLS {
			errorsCh <- server.ListenAndServeTLS(config.CertFile, config.KeyFile)
		} else {
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
