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

// 清洗文件名，保留 Unicode，截断到指定长度
func SanitizeFilenameKeepUnicode(name string, maxLength int) string {
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

	base := name
	ext := ""
	lastDot := strings.LastIndex(name, ".")
	if lastDot > 0 {
		base = name[:lastDot]
		ext = name[lastDot:]
	}

	if windowsReservedNames[strings.ToUpper(base)] {
		base = "_" + base
	}

	if utf8.RuneCountInString(base)+utf8.RuneCountInString(ext) > maxLength {
		maxKeep := maxLength - utf8.RuneCountInString(ext)
		if maxKeep < 1 {
			maxKeep = 1
		}
		runes := []rune(base)
		if len(runes) > maxKeep {
			base = string(runes[:maxKeep])
		}
	}

	return strings.TrimRight(base+ext, " .")
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

func FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
