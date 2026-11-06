package handler_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
)

func postImage(t *testing.T, h http.Handler, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("image", "screenshot.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return post(t, h, "/api/clipboard/image", w.FormDataContentType(), &body)
}

func TestClipboardImageHTTP(t *testing.T) {
	_, h := setup(t)
	get := func(path string) *httptest.ResponseRecorder {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		return res
	}
	settings := get("/api/clipboard/image-config")
	if settings.Code != 200 || !strings.Contains(settings.Body.String(), `"max_size_mb":10`) {
		t.Fatal(settings.Body.String())
	}
	initial := get("/api/clipboard")
	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	res := postImage(t, h, imageData.Bytes())
	if res.Code != 201 {
		t.Fatalf("upload: %d %s", res.Code, res.Body.String())
	}
	var entry model.ClipboardEntry
	if err := json.Unmarshal(res.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Type != "image" || entry.Image.Width != 3 || entry.Image.Height != 2 {
		t.Fatal(entry)
	}
	list := get("/api/clipboard")
	if list.Header().Get("ETag") == initial.Header().Get("ETag") || !strings.Contains(list.Body.String(), entry.Image.URL) {
		t.Fatal("image not reflected in list")
	}
	res = get(entry.Image.URL)
	if res.Code != 200 || res.Header().Get("Content-Type") != "image/png" || res.Header().Get("Cache-Control") != "no-store" || res.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("get image: %d %v", res.Code, res.Header())
	}
	if _, err := png.Decode(bytes.NewReader(res.Body.Bytes())); err != nil {
		t.Fatal(err)
	}
	res = get(entry.Image.URL + "?thumbnail=1")
	if res.Code != 200 || res.Header().Get("Content-Type") != "image/png" || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("thumbnail: %d %v", res.Code, res.Header())
	}
	if _, err := png.Decode(bytes.NewReader(res.Body.Bytes())); err != nil {
		t.Fatal(err)
	}
	if res = get(entry.Image.URL + "?thumbnail=1&download=1"); !bytes.Equal(res.Body.Bytes(), imageData.Bytes()) {
		t.Fatal("thumbnail query changed download content")
	}
	if res = get(entry.Image.URL + "?download=1"); !strings.Contains(res.Header().Get("Content-Disposition"), "attachment") {
		t.Fatal("missing download disposition")
	}
	res = httptest.NewRecorder()
	h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/clipboard/"+entry.ID, nil))
	if res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if res = get(entry.Image.URL); res.Code != 404 || !strings.Contains(res.Body.String(), "error") {
		t.Fatalf("deleted image accessible: %d", res.Code)
	}
	if res = get(entry.Image.URL + "?thumbnail=1"); res.Code != 404 {
		t.Fatalf("deleted thumbnail accessible: %d", res.Code)
	}
	if res = get("/api/clipboard"); res.Header().Get("ETag") != initial.Header().Get("ETag") {
		t.Fatal("delete did not restore empty snapshot")
	}
}

func TestClipboardImageHTTPValidation(t *testing.T) {
	_, h := setup(t)
	for _, data := range [][]byte{[]byte("fake image"), []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), nil} {
		if res := postImage(t, h, data); res.Code != 400 {
			t.Fatalf("invalid image: %d %s", res.Code, res.Body.String())
		}
	}
	if res := postImage(t, h, make([]byte, 10*1024*1024+1)); res.Code != 413 {
		t.Fatalf("oversized: %d %s", res.Code, res.Body.String())
	}
	if res := post(t, h, "/api/clipboard/image", "application/json", strings.NewReader(`{}`)); res.Code != 400 {
		t.Fatal(res.Code)
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if res := post(t, h, "/api/clipboard/image", w.FormDataContentType(), &body); res.Code != 400 {
		t.Fatal(res.Code)
	}
}
