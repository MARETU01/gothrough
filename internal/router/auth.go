package router

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"sync"
	"time"

	"github.com/MARETU01/gothrough/internal/handler"
	"github.com/gin-gonic/gin"
)

const accessCookie = "gothrough_session"
const sessionLifetime = 12 * time.Hour
const maxLoginSources = 4096
const loginSourceLifetime = 2 * time.Minute

type loginBucket struct {
	tokens   float64
	refilled time.Time
}

// Sessions are private to this process. Restarting or changing the password
// revokes them all; logout revokes the individual token immediately.
type accessAuth struct {
	enabled  bool
	password [32]byte
	mu       sync.Mutex
	sessions map[string]time.Time
	sources  map[string]loginBucket
	logins   chan struct{}
}

func newAccessAuth(password string) *accessAuth {
	return &accessAuth{enabled: password != "", password: sha256.Sum256([]byte(password)), sessions: make(map[string]time.Time), sources: make(map[string]loginBucket), logins: make(chan struct{}, 32)}
}

// Caller supplies a peer IP, or a client IP obtained through explicitly trusted
// proxies. Bounded storage and expiration prevent the limiter becoming a leak.
func (a *accessAuth) allowLogin(source string, now time.Time) bool {
	if address, err := netip.ParseAddr(source); err == nil {
		source = address.Unmap().String()
	} else {
		source = "unknown"
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	bucket, exists := a.sources[source]
	if !exists {
		if len(a.sources) >= maxLoginSources {
			oldestKey := ""
			var oldest time.Time
			for key, candidate := range a.sources {
				if now.Sub(candidate.refilled) >= loginSourceLifetime {
					delete(a.sources, key)
					continue
				}
				if oldestKey == "" || candidate.refilled.Before(oldest) {
					oldestKey, oldest = key, candidate.refilled
				}
			}
			if len(a.sources) >= maxLoginSources {
				delete(a.sources, oldestKey)
			}
		}
		bucket = loginBucket{tokens: 10, refilled: now}
	}
	bucket.tokens = min(10, bucket.tokens+max(0, now.Sub(bucket.refilled).Seconds())/3)
	bucket.refilled = now
	allowed := bucket.tokens >= 1
	if allowed {
		bucket.tokens--
	}
	a.sources[source] = bucket
	return allowed
}

func (a *accessAuth) authenticated(c *gin.Context) bool {
	token, err := c.Cookie(accessCookie)
	if err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	expires, ok := a.sessions[token]
	if ok && !time.Now().Before(expires) {
		delete(a.sessions, token)
		return false
	}
	return ok
}

func (a *accessAuth) status(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"enabled": a.enabled, "authenticated": !a.enabled || a.authenticated(c)})
}

func (a *accessAuth) requireSession(c *gin.Context) {
	if !a.enabled {
		return
	}
	c.Header("Cache-Control", "no-store")
	if !a.authenticated(c) {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": "AUTH_REQUIRED", "error": "请先输入访问口令"})
	}
}

// Cookies alone do not authorize cross-origin mutations. Check the browser's
// Origin as well as Fetch Metadata; non-browser clients may omit both headers.
func (a *accessAuth) sameOrigin(c *gin.Context) {
	if !a.enabled || c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
		return
	}
	if origin := c.GetHeader("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host != c.Request.Host {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "ORIGIN_REJECTED", "error": "不允许跨站请求"})
			return
		}
	}
	if site := c.GetHeader("Sec-Fetch-Site"); site == "cross-site" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": "ORIGIN_REJECTED", "error": "不允许跨站请求"})
	}
}

func (a *accessAuth) login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !a.enabled {
		a.status(c)
		return
	}
	now := time.Now()
	if !a.allowLogin(c.ClientIP(), now) {
		c.Header("Retry-After", "3")
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "AUTH_RATE_LIMITED", "error": "尝试过于频繁，请稍后再试"})
		return
	}
	// Bound simultaneous parsing independently from each source's rate budget.
	select {
	case a.logins <- struct{}{}:
		defer func() { <-a.logins }()
	default:
		c.Header("Retry-After", "3")
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "AUTH_RATE_LIMITED", "error": "尝试过于频繁，请稍后再试"})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := handler.BindLimitedJSON(c, &req, 2048); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"code": "REQUEST_TOO_LARGE", "error": "请求体过大"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_AUTH_REQUEST", "error": "无效的口令请求"})
		return
	}
	digest := sha256.Sum256([]byte(req.Password))
	if subtle.ConstantTimeCompare(digest[:], a.password[:]) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"code": "AUTH_INVALID", "error": "访问口令不正确"})
		return
	}
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	token := hex.EncodeToString(random[:])
	a.mu.Lock()
	for key, expires := range a.sessions {
		if !now.Before(expires) {
			delete(a.sessions, key)
		}
	}
	// Replacing the current browser's session should not consume an extra slot.
	if previous, err := c.Cookie(accessCookie); err == nil {
		delete(a.sessions, previous)
	}
	if len(a.sessions) >= 4096 {
		a.mu.Unlock()
		c.JSON(http.StatusServiceUnavailable, gin.H{"code": "AUTH_BUSY", "error": "访问会话已满，请稍后再试"})
		return
	}
	a.sessions[token] = now.Add(sessionLifetime)
	a.mu.Unlock()
	a.setCookie(c, token, int(sessionLifetime.Seconds()))
	c.JSON(http.StatusOK, gin.H{"enabled": true, "authenticated": true})
}

func (a *accessAuth) setCookie(c *gin.Context, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: accessCookie, Value: value, Path: "/api", MaxAge: maxAge, HttpOnly: true, Secure: c.Request.TLS != nil, SameSite: http.SameSiteStrictMode})
}

func (a *accessAuth) logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if token, err := c.Cookie(accessCookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, token)
		a.mu.Unlock()
	}
	a.setCookie(c, "", -1)
	c.Status(http.StatusNoContent)
}
