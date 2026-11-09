package router

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestLoginRejectsInvalidJSONBeforeCreatingSession(t *testing.T) {
	for _, body := range []string{
		`{"password":"test-password","extra":true}`,
		`{"password":"test-password"} {}`,
		`{"password":"test-password"} garbage`,
		`{"password":"` + strings.Repeat("a", 2048) + `"}`,
		`{"password":"test-password"}` + strings.Repeat(" ", 2048),
	} {
		t.Run(body[:min(len(body), 70)], func(t *testing.T) {
			a := newAccessAuth("test-password")
			r := gin.New()
			r.POST("/login", a.login)
			res := authRequest(r, "POST", "/login", body, nil, "", false)
			want := http.StatusBadRequest
			if len(body) > 2048 {
				want = http.StatusRequestEntityTooLarge
			}
			if res.Code != want || len(res.Result().Cookies()) != 0 || len(a.sessions) != 0 {
				t.Fatalf("invalid JSON created session: %d %s", res.Code, res.Body.String())
			}
			valid := authRequest(r, "POST", "/login", `{"password":"test-password"}`+" \n", nil, "", false)
			if valid.Code != 200 || len(valid.Result().Cookies()) != 1 {
				t.Fatalf("valid login: %d %s", valid.Code, valid.Body.String())
			}
		})
	}
}
