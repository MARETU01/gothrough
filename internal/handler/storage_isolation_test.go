package handler_test

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/service"
)

func TestRoutersKeepIndependentStoragePaths(t *testing.T) {
	firstService, first := setup(t)
	_, second := setup(t)
	for _, fixture := range []struct {
		router  *testRouter
		content string
	}{{first, "first"}, {second, "second"}} {
		if err := os.WriteFile(filepath.Join(fixture.router.uploadDir, "same.txt"), []byte(fixture.content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	read := func(router *testRouter, path string) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		return response
	}
	for _, fixture := range []struct {
		router  *testRouter
		content string
	}{{first, "first"}, {second, "second"}, {first, "first"}} {
		response := read(fixture.router, "/api/files/same.txt")
		if response.Code != 200 || response.Body.String() != fixture.content {
			t.Fatalf("download crossed storage roots: %d %q", response.Code, response.Body.String())
		}
	}
	info := initHTTP(t, first, "only-first.txt", 0)
	if _, _, err := firstService.CompleteSession(info.SessionID); err != nil {
		t.Fatal(err)
	}
	if response := read(second, "/api/files/only-first.txt"); response.Code != 404 {
		t.Fatalf("upload leaked into second instance: %d", response.Code)
	}
	if _, err := firstService.SaveText("same.txt", service.TextVersion([]byte("first")), "changed"); err != nil {
		t.Fatal(err)
	}
	response := read(first, "/api/files/same.txt?preview=info")
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"text":"changed"`) {
		t.Fatal("preview used another instance's storage")
	}
	if err := firstService.DeleteFile("same.txt"); err != nil {
		t.Fatal(err)
	}
	if response := read(second, "/api/files/same.txt"); response.Code != 200 || response.Body.String() != "second" {
		t.Fatal("editing/deleting crossed storage roots")
	}
}
