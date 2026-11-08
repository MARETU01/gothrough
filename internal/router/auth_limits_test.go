package router

import (
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
)

func TestLoginLimitsIsolateSourcesAndIgnoreSpoofedHeaders(t *testing.T) {
	for _, trusted := range []bool{false, true} {
		t.Run(fmt.Sprint("trusted=", trusted), func(t *testing.T) {
			settings := config.AuthSettings{Password: "test-password"}
			if trusted {
				settings.TrustedProxies = []string{"192.0.2.1"}
			}
			r := SetupRouter(nil, nil, nil, config.DefaultLoggingSettings(), settings)
			request := func(peer, forwarded, password string) int {
				req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"password":"`+password+`"}`))
				req.RemoteAddr = peer + ":12345"
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Forwarded-For", forwarded)
				req.Header.Set("X-Real-IP", forwarded)
				w := httptest.NewRecorder()
				r.ServeHTTP(w, req)
				return w.Code
			}
			for range 10 {
				if status := request("192.0.2.1", "198.51.100.1", "wrong"); status != 401 {
					t.Fatal(status)
				}
			}
			if status := request("192.0.2.1", "198.51.100.1", "test-password"); status != 429 {
				t.Fatalf("source not limited: %d", status)
			}
			want := 429
			if trusted {
				want = 200
			}
			if status := request("192.0.2.1", "198.51.100.2", "test-password"); status != want {
				t.Fatalf("forwarded client isolation: %d want %d", status, want)
			}
			if status := request("192.0.2.2", "198.51.100.1", "test-password"); status != 200 {
				t.Fatalf("other peer blocked: %d", status)
			}
		})
	}
}

func TestLoginSourceStorageBoundAndExpiration(t *testing.T) {
	a := newAccessAuth("password")
	now := time.Now()
	for i := range maxLoginSources + 20 {
		if !a.allowLogin(fmt.Sprintf("10.%d.%d.%d", i/65536, (i/256)%256, i%256), now) {
			t.Fatal("fresh source rejected")
		}
	}
	if len(a.sources) != maxLoginSources {
		t.Fatalf("unbounded source storage: %d", len(a.sources))
	}
	if !a.allowLogin("203.0.113.1", now.Add(loginSourceLifetime)) || len(a.sources) != 1 {
		t.Fatalf("expired sources retained: %d", len(a.sources))
	}
	for range 9 {
		if !a.allowLogin("203.0.113.1", now.Add(loginSourceLifetime)) {
			t.Fatal("unexpected limit")
		}
	}
	if a.allowLogin("203.0.113.1", now.Add(loginSourceLifetime)) {
		t.Fatal("burst exceeded")
	}
	if !a.allowLogin("203.0.113.1", now.Add(loginSourceLifetime+3*time.Second)) {
		t.Fatal("bucket did not refill")
	}
}
