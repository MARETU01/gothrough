package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBrowserQueryValidationAndETags(t *testing.T) {
	_, h := setup(t)
	read := func(query, tag string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/files?view=browser&"+query, nil)
		if tag != "" {
			req.Header.Set("If-None-Match", tag)
		}
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	first := read("page=1&page_size=20", "")
	if first.Code != 200 || first.Header().Get("ETag") == "" {
		t.Fatalf("initial: %d %s", first.Code, first.Body.String())
	}
	if res := read("page=1&page_size=20", first.Header().Get("ETag")); res.Code != 304 || res.Body.Len() != 0 {
		t.Fatal("conditional query failed")
	}
	if res := read("q=different", first.Header().Get("ETag")); res.Code != 200 {
		t.Fatal("validator leaked between queries")
	}
	for _, query := range []string{"page=0", "page=-1", "page=abc", "page=9999999999999999999999999", "page_size=101", "page_size=-1", "sort=invalid", "dir=../secret", "dir=%2Fabsolute", "dir=a%5Cb", "dir=a%00b"} {
		if res := read(query, ""); res.Code != 400 {
			t.Errorf("query %q: got %d", query, res.Code)
		}
	}
}
