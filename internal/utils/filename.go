package utils

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true,
	"COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true,
	"LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

var illegalCharsRegex = regexp.MustCompile(`[<>:"/\\|?*]`)
var multiSpaceRegex = regexp.MustCompile(`\s+`)
var multiUnderscoreRegex = regexp.MustCompile(`_+`)

// A byte limit also bounds UTF-16 length on Windows and leaves room for
// filesystem metadata conventions. Conflict suffixes are included in this cap.
const MaxFilenameBytes = 200

// 清洗文件名并按 UTF-8 字节数截断，不拆开 Unicode 字符。
func SanitizeFilenameKeepUnicode(name string, maxBytes int) string {
	if name == "" {
		return ""
	}

	name = strings.ReplaceAll(name, `\`, "/")
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}

	name = strings.TrimSpace(name)

	// 移除控制字符（保留 tab）
	var cleaned []rune
	for _, ch := range name {
		if ch == 0 || (ch < 32 && ch != '\t') {
			continue
		}
		cleaned = append(cleaned, ch)
	}
	name = string(cleaned)

	name = illegalCharsRegex.ReplaceAllString(name, "_")
	name = multiSpaceRegex.ReplaceAllString(name, " ")
	name = strings.TrimSpace(name)
	name = multiUnderscoreRegex.ReplaceAllString(name, "_")
	name = strings.TrimRight(name, " .")

	if name == "" || name == "." || name == ".." {
		return ""
	}

	return FilenameWithSuffix(name, "", maxBytes)
}

// FilenameWithSuffix fits the stem, extension and complete suffix together.
// Its input is a sanitized single path component; directory names are untouched.
func FilenameWithSuffix(name, suffix string, maxBytes int) string {
	if maxBytes <= len(suffix) {
		return ""
	}
	base, ext := name, ""
	if dot := strings.LastIndex(name, "."); dot > 0 {
		base, ext = name[:dot], name[dot:]
	}
	if reservedFilename(base) {
		base = "_" + base
	}
	ext = strings.TrimRight(truncateUTF8(ext, maxBytes-len(suffix)-1), " .")
	baseLimit := maxBytes - len(suffix) - len(ext)
	base = strings.TrimRight(truncateUTF8(base, baseLimit), " .")
	if base == "" {
		base = "_"
	}
	if suffix == "" && reservedFilename(base) {
		base = truncateUTF8("_"+base, baseLimit)
	}
	return base + suffix + ext
}

func reservedFilename(base string) bool {
	first, _, _ := strings.Cut(base, ".")
	return windowsReservedNames[strings.ToUpper(strings.TrimRight(first, " ."))]
}

func truncateUTF8(text string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	if len(text) <= maxBytes {
		return text
	}
	for !utf8.RuneStart(text[maxBytes]) {
		maxBytes--
	}
	return text[:maxBytes]
}

// 安全化上传相对路径，防止目录遍历攻击。
// filename 是实际文件名（HTTP 路由参数已经解码），此处不得再次进行 URL 解码。
func SafeUploadRelpath(filename, uploadFolder string) string {
	if filename == "" {
		return ""
	}

	filename = strings.ReplaceAll(filename, `\`, "/")

	if strings.HasPrefix(filename, "/") {
		return ""
	}

	cleaned := filepath.Clean(filename)
	if strings.HasPrefix(cleaned, "..") || cleaned == ".." {
		return ""
	}

	parts := strings.Split(cleaned, "/")
	var validParts []string
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return ""
		}
		validParts = append(validParts, part)
	}

	if len(validParts) == 0 {
		return ""
	}

	rel := strings.Join(validParts, "/")

	// 安全检查：确保路径在上传目录内
	rootReal, _ := filepath.Abs(uploadFolder)
	fullReal, _ := filepath.Abs(filepath.Join(uploadFolder, rel))
	if fullReal != rootReal && !strings.HasPrefix(fullReal, rootReal+string(os.PathSeparator)) {
		return ""
	}

	return rel
}
