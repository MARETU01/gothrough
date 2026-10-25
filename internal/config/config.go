package config

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxContentLength = 50 * 1024 * 1024 // 单次请求最大 50MB
	ChunkSize        = 8 * 1024 * 1024  // 默认分块大小 8MiB，减少高速链路请求开销
)

var (
	UploadFolder string
	TempFolder   string
	BaseDir      string
)

func Init() {
	exePath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	BaseDir = filepath.Dir(exePath)

	// go run 或 IDE 临时构建目录时，使用当前工作目录
	if strings.Contains(BaseDir, "go-build") || strings.Contains(BaseDir, "\\go-build") ||
		strings.Contains(BaseDir, "JetBrains") || strings.Contains(BaseDir, "\\JetBrains") {
		BaseDir, _ = os.Getwd()
	}

	UploadFolder = filepath.Join(BaseDir, "uploads")
	TempFolder = filepath.Join(BaseDir, "temp_uploads")

	if err := os.MkdirAll(UploadFolder, 0755); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(TempFolder, 0700); err != nil {
		log.Fatal(err)
	}

	// 清理上次残留的临时分块
	if entries, err := os.ReadDir(TempFolder); err == nil {
		for _, entry := range entries {
			path := filepath.Join(TempFolder, entry.Name())
			if entry.IsDir() {
				_ = os.RemoveAll(path)
			}
		}
	}

	log.Printf("上传目录: %s", UploadFolder)
	log.Printf("临时目录: %s", TempFolder)
}
