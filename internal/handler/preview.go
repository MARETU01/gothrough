package handler

import (
	"encoding/binary"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/MARETU01/gothrough/internal/service"
	"github.com/gin-gonic/gin"
)

const maxPreviewText = service.MaxTextBytes

// Only explicitly supported types can be served inline on the application origin.
func servePreview(c *gin.Context, file *os.File, info os.FileInfo) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	ext := strings.ToLower(filepath.Ext(info.Name()))
	kind, contentType := "", ""
	if service.IsTextFile(info.Name()) {
		kind, contentType = "text", "text/plain; charset=utf-8"
	} else {
		switch ext {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf", ".mp3", ".wav", ".ogg", ".oga", ".ogv", ".mp4", ".m4a", ".webm":
			var head [512]byte
			n, err := file.ReadAt(head[:], 0)
			if err != nil && err != io.EOF {
				respondError(c, err, 500, "FILE_READ_FAILED", "读取文件失败，请稍后重试")
				return
			}
			contentType = http.DetectContentType(head[:n])
			if contentType == "application/octet-stream" {
				contentType = previewAudioType(ext, head[:n])
			}
			switch contentType {
			case "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp":
				kind = "image"
			case "application/pdf":
				kind = "pdf"
			case "audio/mpeg", "audio/wave", "audio/ogg", "audio/mp4":
				kind = "audio"
			case "video/mp4", "video/webm", "application/ogg":
				kind = "video"
				if ext == ".m4a" || ext == ".oga" || ext == ".ogg" {
					kind = "audio"
				}
			}
		}
	}
	if kind == "" {
		respondError(c, nil, 415, "PREVIEW_UNSUPPORTED", "此文件类型不支持预览，请下载查看")
		return
	}
	var text string
	var version string
	if kind == "text" {
		data, err := io.ReadAll(io.LimitReader(file, maxPreviewText+1))
		if err != nil {
			respondError(c, err, 500, "FILE_READ_FAILED", "读取文件失败，请稍后重试")
			return
		}
		if len(data) > maxPreviewText {
			respondError(c, nil, 413, "PREVIEW_TOO_LARGE", "文本预览最大支持 1 MiB，请下载查看")
			return
		}
		if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
			respondError(c, nil, 415, "PREVIEW_ENCODING", "仅支持 UTF-8 文本预览，请下载查看")
			return
		}
		text = service.EditorText(data)
		version = service.TextVersion(data)
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			respondError(c, err, 500, "FILE_READ_FAILED", "读取文件失败，请稍后重试")
			return
		}
	}
	if c.Query("preview") == "info" {
		c.JSON(http.StatusOK, gin.H{"kind": kind, "mime_type": contentType, "text": text, "version": version})
		return
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": info.Name()}))
	c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'")
	if kind == "text" {
		c.Header("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'self'")
	}
	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), file)
}

// MIME sniffing recognizes ID3 and mp4 brands but misses untagged MPEG audio
// and audio-only M4A brands. Keep the fallback bounded and validate signatures;
// an extension alone never permits inline content.
func previewAudioType(ext string, data []byte) string {
	if ext == ".mp3" && len(data) >= 4 && data[0] == 0xff && data[1]&0xe0 == 0xe0 &&
		data[1]&0x18 != 0x08 && data[1]&0x06 != 0 &&
		data[2]&0xf0 != 0 && data[2]&0xf0 != 0xf0 && data[2]&0x0c != 0x0c && data[3]&0x03 != 0x02 {
		return "audio/mpeg"
	}
	if ext == ".m4a" && len(data) >= 16 && string(data[4:8]) == "ftyp" {
		size := uint64(binary.BigEndian.Uint32(data[:4]))
		if size < 16 || size > uint64(len(data)) || size%4 != 0 {
			return "application/octet-stream"
		}
		for offset := 8; offset < int(size); offset += 4 {
			if offset == 12 { // minor version, not a compatible brand
				continue
			}
			if brand := string(data[offset : offset+4]); brand == "M4A " || brand == "M4B " {
				return "audio/mp4"
			}
		}
	}
	return "application/octet-stream"
}
