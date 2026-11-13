package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/MARETU01/gothrough/internal/utils"
	"uuid"
)

const MaxTextBytes = 1 << 20

var (
	ErrTextType     = errors.New("此文件类型不支持文本编辑")
	ErrTextSize     = errors.New("文本最大支持 1 MiB")
	ErrTextEncoding = errors.New("仅支持不含 NUL 的 UTF-8 文本")
	ErrTextConflict = errors.New("文件已被修改，请重新加载后再编辑")
)

func IsTextFile(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".txt", ".md", ".log", ".csv", ".json", ".yaml", ".yml", ".toml", ".ini", ".xml", ".html", ".htm", ".svg", ".go", ".js", ".jsx", ".ts", ".tsx", ".css", ".py", ".sh", ".sql", ".rs", ".java", ".c", ".h", ".cpp":
		return true
	}
	return false
}

func TextVersion(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func ValidateText(data []byte) error {
	if len(data) > MaxTextBytes {
		return ErrTextSize
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return ErrTextEncoding
	}
	return nil
}

// Browsers normalize textarea line endings. Keep BOM and the source's first
// newline style on disk; an unchanged editor preserves even mixed endings.
func EditorText(data []byte) string {
	text := strings.TrimPrefix(string(data), "\ufeff")
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}

func encodeEditedText(text string, original []byte) []byte {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	if text == EditorText(original) {
		return original
	}
	if i := bytes.IndexAny(original, "\r\n"); i >= 0 && original[i] == '\r' {
		ending := "\r"
		if i+1 < len(original) && original[i+1] == '\n' {
			ending = "\r\n"
		}
		text = strings.ReplaceAll(text, "\n", ending)
	}
	if bytes.HasPrefix(original, []byte{0xef, 0xbb, 0xbf}) {
		text = "\ufeff" + text
	}
	return []byte(text)
}

func (s *FileService) SaveText(filename, version, text string) (string, error) {
	if !IsTextFile(filename) {
		return "", ErrTextType
	}
	if err := ValidateText([]byte(text)); err != nil {
		return "", err
	}
	rel := s.RelativePath(filename)
	if rel == "" {
		return "", ErrPath
	}
	// Serialize version comparison and replacement with other edits and deletes.
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deletionOverlaps(filepath.ToSlash(rel)) {
		return "", ErrPathDeleting
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return "", utils.StorageError("打开上传目录失败", err)
	}
	defer root.Close()
	info, err := root.Lstat(rel)
	if err != nil {
		return "", utils.StorageError("读取文件信息失败", err)
	}
	if !info.Mode().IsRegular() {
		return "", ErrTextType
	}
	file, err := root.Open(rel)
	if err != nil {
		return "", utils.StorageError("打开文本失败", err)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, MaxTextBytes+1))
	err = errors.Join(readErr, file.Close())
	if err != nil {
		return "", utils.StorageError("读取文本失败", err)
	}
	if err := ValidateText(data); err != nil {
		return "", err
	}
	if version == "" || TextVersion(data) != version {
		return "", ErrTextConflict
	}
	if info.Mode().Perm()&0222 == 0 {
		return "", utils.StorageError("文件不可写", os.ErrPermission)
	}
	updated := encodeEditedText(text, data)
	if err := ValidateText(updated); err != nil {
		return "", err
	}
	if bytes.Equal(updated, data) {
		return version, nil
	}
	// Hide the temporary file from cached listings until publication completes.
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	tempName := filepath.Join(filepath.Dir(rel), ".gothrough-edit-"+uuid.NewV7().String()+".tmp")
	temp, err := root.OpenFile(tempName, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", utils.StorageError("创建编辑临时文件失败", err)
	}
	defer root.Remove(tempName)
	_, writeErr := temp.Write(updated)
	if writeErr == nil {
		writeErr = temp.Chmod(info.Mode().Perm())
	}
	if writeErr == nil {
		writeErr = temp.Sync()
	}
	err = errors.Join(writeErr, temp.Close())
	if err != nil {
		return "", utils.StorageError("保存文本失败", err)
	}
	if err := root.Rename(tempName, rel); err != nil {
		return "", utils.StorageError("替换文本失败", err)
	}
	s.listing = nil
	return TextVersion(updated), nil
}
