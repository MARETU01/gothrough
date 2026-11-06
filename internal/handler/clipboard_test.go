package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/service"
)

func TestClipboardHTTP(t *testing.T) {
	_, h := setup(t)
	get := func() []model.ClipboardEntry {
		t.Helper()
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/clipboard", nil))
		if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("list: %d", res.Code)
		}
		var body struct {
			Entries []model.ClipboardEntry `json:"entries"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Entries == nil {
			t.Fatal("null entries")
		}
		return body.Entries
	}
	if len(get()) != 0 {
		t.Fatal("expected empty history")
	}
	text := " 中文\n<script>alert('text')</script>\t "
	body, _ := json.Marshal(model.ClipboardRequest{Text: text})
	res := post(t, h, "/api/clipboard", "application/json", bytes.NewReader(body))
	if res.Code != 201 {
		t.Fatalf("create: %d %s", res.Code, res.Body.String())
	}
	var entry model.ClipboardEntry
	if err := json.Unmarshal(res.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry.Text != text || entry.ID == "" || len(get()) != 1 {
		t.Fatal("text changed")
	}
	for _, status := range []int{200, 404} {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/clipboard/"+entry.ID, nil))
		if res.Code != status {
			t.Fatalf("delete: %d expected %d", res.Code, status)
		}
	}
	if len(get()) != 0 {
		t.Fatal("delete failed")
	}
	for i := 0; i < 2; i++ {
		res := post(t, h, "/api/clipboard", "application/json", bytes.NewReader(body))
		if res.Code != 201 {
			t.Fatalf("create before clear: %d", res.Code)
		}
	}
	for i := 0; i < 2; i++ {
		res := httptest.NewRecorder()
		h.ServeHTTP(res, httptest.NewRequest(http.MethodDelete, "/api/clipboard", nil))
		if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("clear: %d %s", res.Code, res.Body.String())
		}
		if len(get()) != 0 {
			t.Fatal("clear failed")
		}
	}
}

func TestClipboardHTTPValidation(t *testing.T) {
	_, h := setup(t)
	for _, test := range []struct {
		name, body string
		status     int
	}{
		{"empty", `{"text":" "}`, 400},
		{"missing", `{}`, 400},
		{"null", `null`, 400},
		{"unknown", `{"text":"valid","extra":true}`, 400},
		{"wrong type", `{"text":1}`, 400},
		{"invalid", `{`, 400},
		{"extra document", `{"text":"valid"} {}`, 400},
		{"too much text", `{"text":"` + strings.Repeat("中", service.ClipboardMaxBytes/3+1) + `"}`, 413},
		{"oversized body", `{"text":"ok"}` + strings.Repeat(" ", service.ClipboardMaxBytes*6+1024), 413},
	} {
		t.Run(test.name, func(t *testing.T) {
			res := post(t, h, "/api/clipboard", "application/json", strings.NewReader(test.body))
			if res.Code != test.status {
				t.Fatalf("status %d: %s", res.Code, res.Body.String())
			}
		})
	}
	// Request overhead must allow JSON's six-byte escaping at the text limit.
	body, _ := json.Marshal(model.ClipboardRequest{Text: strings.Repeat("\x01", service.ClipboardMaxBytes)})
	res := post(t, h, "/api/clipboard", "application/json", bytes.NewReader(body))
	if res.Code != 201 {
		t.Fatalf("escaped boundary: %d %s", res.Code, res.Body.String())
	}
}

func TestClipboardConditionalList(t *testing.T) {
	_, h := setup(t)
	get := func(validators ...string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/clipboard", nil)
		for _, value := range validators {
			req.Header.Add("If-None-Match", value)
		}
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	initial := get()
	etag := initial.Header().Get("ETag")
	if initial.Code != 200 || !strings.HasPrefix(etag, `"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("initial response: %d %q", initial.Code, etag)
	}
	for _, validators := range [][]string{{etag}, {"W/" + etag}, {`"other", W/` + etag}, {"*"}, {`"other"`, etag}} {
		res := get(validators...)
		if res.Code != 304 || res.Body.Len() != 0 || res.Header().Get("ETag") != etag || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("conditional response for %q: %d %s", validators, res.Code, res.Body.String())
		}
	}
	for _, value := range []string{`"different"`, strings.Trim(etag, `"`), "w/" + etag} {
		if res := get(value); res.Code != 200 || res.Body.String() != initial.Body.String() {
			t.Fatalf("nonmatching validator %q: %d", value, res.Code)
		}
	}
	created := post(t, h, "/api/clipboard", "application/json", strings.NewReader(`{"text":"new text"}`))
	if created.Code != 201 {
		t.Fatal(created.Body.String())
	}
	changed := get(etag)
	if changed.Code != 200 || changed.Header().Get("ETag") == etag || !strings.Contains(changed.Body.String(), "new text") {
		t.Fatalf("changed response: %d %s", changed.Code, changed.Body.String())
	}
	clear := httptest.NewRecorder()
	h.ServeHTTP(clear, httptest.NewRequest(http.MethodDelete, "/api/clipboard", nil))
	if res := get(changed.Header().Get("ETag")); clear.Code != 200 || res.Code != 200 || res.Body.String() != initial.Body.String() || res.Header().Get("ETag") != etag {
		t.Fatalf("cleared response: %d %s", res.Code, res.Body.String())
	}
}
