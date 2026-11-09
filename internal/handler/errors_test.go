package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicErrorsIncludeStableCodesAndOriginalMessages(t *testing.T) {
	_, h := setup(t)
	for _, tc := range []struct {
		method, path, body, code, message string
		status                            int
	}{
		{http.MethodPost, "/api/upload/init", `{}`, "INVALID_UPLOAD", "缺少 filename 或 total_size", http.StatusBadRequest},
		{http.MethodPost, "/api/upload/cancel", `{}`, "MISSING_SESSION", "缺少 session_id", http.StatusBadRequest},
		{http.MethodPost, "/api/clipboard", `{"text":""}`, "INVALID_TEXT", "文本不能为空，且不能超过 64 KiB", http.StatusBadRequest},
		{http.MethodPost, "/api/clipboard", `{`, "INVALID_TEXT_REQUEST", "无效的文本请求", http.StatusBadRequest},
	} {
		t.Run(tc.code, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			res := httptest.NewRecorder()
			h.ServeHTTP(res, req)
			var body struct{ Code, Error string }
			if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if res.Code != tc.status || body.Code != tc.code || body.Error != tc.message {
				t.Fatalf("status=%d body=%+v", res.Code, body)
			}
		})
	}
}
