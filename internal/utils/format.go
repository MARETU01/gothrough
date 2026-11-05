package utils

import "fmt"

// 格式化文件大小为人类可读字符串
func FormatFileSize(sizeBytes int64) string {
	if sizeBytes <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	k := float64(1024)
	size := float64(sizeBytes)
	i := 0
	for size >= k && i < len(units)-1 {
		size /= k
		i++
	}
	return fmt.Sprintf("%.2f %s", size, units[i])
}
