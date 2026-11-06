package router

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/gin-gonic/gin"
)

func authRequest(r http.Handler, method, path, body string, cookie *http.Cookie, origin string, secure bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if secure {
		req.TLS = &tls.ConnectionState{}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAccessProtectsAllContentRoutes(t *testing.T) {
	r := SetupRouter(nil, nil, config.DefaultLoggingSettings(), config.AuthSettings{Password: "test-password"})
	for _, route := range r.Routes() {
		if strings.HasPrefix(route.Path, "/api/auth/") {
			continue
		}
		path := strings.ReplaceAll(strings.ReplaceAll(route.Path, ":session_id", "unknown"), ":id", "unknown")
		path = strings.ReplaceAll(path, "*filename", "sample.txt")
		w := authRequest(r, route.Method, path, `{}`, nil, "", false)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: got %d", route.Method, path, w.Code)
		}
	}
}

func TestAccessSessionLifecycle(t *testing.T) {
	gin.SetMode(gin.TestMode)
	a := newAccessAuth("test-password")
	r := gin.New()
	r.Use(a.sameOrigin)
	r.POST("/api/auth/login", a.login)
	r.POST("/api/auth/logout", a.logout)
	r.GET("/api/auth/status", a.status)
	r.GET("/api/private", a.requireSession, func(c *gin.Context) { c.Status(204) })
	if w := authRequest(r, "POST", "/api/auth/login", `{"password":"wrong"}`, nil, "", false); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := authRequest(r, "POST", "/api/auth/login", `{"password":"test-password"}`, nil, "https://other.example", false); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := authRequest(r, "POST", "/api/auth/login", `{"password":"test-password"}`, nil, "", true)
	if w.Code != 200 || len(w.Result().Cookies()) != 1 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/api" || cookie.MaxAge != 43200 {
		t.Fatalf("cookie: %+v", cookie)
	}
	if w = authRequest(r, "GET", "/api/private", "", cookie, "", true); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w = authRequest(r, "GET", "/api/auth/status", "", cookie, "", true); !strings.Contains(w.Body.String(), `"authenticated":true`) {
		t.Fatal(w.Body.String())
	}
	if w = authRequest(r, "POST", "/api/auth/logout", "", cookie, "", true); w.Code != 204 || w.Result().Cookies()[0].MaxAge != -1 {
		t.Fatal(w.Code)
	}
	if w = authRequest(r, "GET", "/api/private", "", cookie, "", true); w.Code != 401 {
		t.Fatal("logout did not revoke token")
	}
	// Even a correctly shaped random cookie cannot authorize access.
	if w = authRequest(r, "GET", "/api/private", "", &http.Cookie{Name: accessCookie, Value: strings.Repeat("a", 64)}, "", false); w.Code != 401 {
		t.Fatal("forged cookie accepted")
	}
	a.sessions["expired"] = time.Now().Add(-time.Second)
	if w = authRequest(r, "GET", "/api/private", "", &http.Cookie{Name: accessCookie, Value: "expired"}, "", false); w.Code != 401 {
		t.Fatal("expired cookie accepted")
	}
}

func TestAccessDisabledAndRateLimit(t *testing.T) {
	for _, password := range []string{"", "test-password"} {
		a := newAccessAuth(password)
		r := gin.New()
		r.POST("/login", a.login)
		r.GET("/private", a.requireSession, func(c *gin.Context) { c.Status(204) })
		if password == "" {
			if w := authRequest(r, "GET", "/private", "", nil, "", false); w.Code != 204 {
				t.Fatal("disabled auth blocked request")
			}
			continue
		}
		if w := authRequest(r, "POST", "/login", `{"password":"`+strings.Repeat("a", 3000)+`"}`, nil, "", false); w.Code != 400 {
			t.Fatal("oversized login accepted")
		}
		a.tokens = 0
		if w := authRequest(r, "POST", "/login", `{"password":"test-password"}`, nil, "", false); w.Code != 429 || w.Header().Get("Retry-After") == "" {
			t.Fatal("missing rate limit")
		}
	}
}
