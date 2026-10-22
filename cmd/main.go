package main

import (
	"flag"
	"log"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/MARETU01/gothrough/internal/router"
	"github.com/MARETU01/gothrough/internal/service"
)

func main() {
	config.Init()

	uploadService := service.NewUploadService()
	uploadHandler := handler.NewUploadHandler(uploadService)
	r := router.SetupRouter(uploadHandler)

	enableTLS := flag.Bool("tls", false, "enable https tls server, use -tls=true to open")
	flag.Parse()
	if *enableTLS {
		log.Printf("启动 Gin 文件上传服务器，端口 %s", config.ServerPortTLS)
		if err := r.RunTLS(config.ServerPortTLS, config.CertFile, config.KeyFile); err != nil {
			log.Fatal(err)
		}
	}

	log.Printf("启动 Gin 文件上传服务器，端口 %s", config.ServerPort)

	if err := r.Run(config.ServerPort); err != nil {
		log.Fatal(err)
	}
}
