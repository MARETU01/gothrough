package router

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const accessCookie = "gothrough_session"
const sessionLifetime = 12 * time.Hour

// Sessions are private to this process. Restarting or changing the password
// revokes them all; logout revokes the individual token immediately.
type accessAuth struct {
	enabled  bool
	password [32]byte
	mu       sync.Mutex
	sessions map[string]time.Time
	tokens   float64
	refilled time.Time
}

func newAccessAuth(password string) *accessAuth {
	return &accessAuth{enabled: password != "", password: sha256.Sum256([]byte(password)), sessions: make(map[string]time.Time), tokens: 10, refilled: time.Now()}
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
	// One shared bucket bounds guessing and memory without trusting proxy/IP headers.
	a.mu.Lock()
	now := time.Now()
	a.tokens = min(10, a.tokens+now.Sub(a.refilled).Seconds()/3)
	a.refilled = now
	allowed := a.tokens >= 1
	if allowed {
		a.tokens--
	}
	a.mu.Unlock()
	if !allowed {
		c.Header("Retry-After", "3")
		c.JSON(http.StatusTooManyRequests, gin.H{"code": "AUTH_RATE_LIMITED", "error": "尝试过于频繁，请稍后再试"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
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
