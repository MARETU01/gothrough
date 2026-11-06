package utils

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestFilenameByteLimitsAndSuffix(t *testing.T) {
	dir := t.TempDir()
	for i, original := range []string{
		strings.Repeat("中", 200) + ".txt",
		strings.Repeat("😀", 100) + ".zip",
		"a." + strings.Repeat("长扩展名", 100),
		strings.Repeat("a", 500), "CON.txt", "CON.extra.txt", "LPT1", ".hidden",
	} {
		name := SanitizeFilenameKeepUnicode(original, MaxFilenameBytes)
		if name == "" || len(name) > MaxFilenameBytes || !utf8.ValidString(name) {
			t.Fatalf("invalid name for %q: %q", original, name)
		}
		if strings.HasSuffix(original, ".txt") && !strings.HasSuffix(name, ".txt") {
			t.Fatalf("extension lost: %s", name)
		}
		for _, suffix := range []string{"", "_01234567-89ab-cdef-0123-456789abcdef"} {
			candidate := FilenameWithSuffix(name, suffix, MaxFilenameBytes)
			if len(candidate) > MaxFilenameBytes || !utf8.ValidString(candidate) || !strings.Contains(candidate, suffix) {
				t.Fatalf("invalid suffix result: %s", candidate)
			}
			// Exercise the host filesystem, including Windows reserved-name rules.
			path := filepath.Join(dir, candidate)
			if err := os.WriteFile(path, []byte{byte(i)}, 0600); err != nil {
				t.Fatalf("cannot create sanitized name %q: %v", candidate, err)
			}
		}
	}
}

func TestFilenameSmallLimits(t *testing.T) {
	for limit := 0; limit <= MaxFilenameBytes; limit++ {
		for _, original := range []string{"CONabcdef.txt", "中😀.中文", "a." + strings.Repeat("长", 300)} {
			name := SanitizeFilenameKeepUnicode(original, limit)
			if len(name) > limit || !utf8.ValidString(name) {
				t.Fatalf("limit %d exceeded: %q", limit, name)
			}
		}
	}
	if name := SanitizeFilenameKeepUnicode("CONabc", 3); name != "_CO" {
		t.Fatalf("truncation introduced reserved name: %q", name)
	}
	for _, name := range []string{"", "...", "\x00", " "} {
		if got := SanitizeFilenameKeepUnicode(name, MaxFilenameBytes); got != "" {
			t.Fatalf("expected empty name: %q", got)
		}
	}
}
