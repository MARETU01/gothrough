package handler_test

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompletionHTTPReplaysReceiptAndStatus(t *testing.T) {
	s, h := setup(t)
	info := initHTTP(t, h, "lost.txt", 0)
	var receipt map[string]any
	for range 2 {
		response := post(t, h, "/api/upload/complete", "application/json", strings.NewReader(`{"session_id":"`+info.SessionID+`"}`))
		if response.Code != 200 {
			t.Fatalf("completion retry: %d %s", response.Code, response.Body.String())
		}
		var current map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &current); err != nil {
			t.Fatal(err)
		}
		if receipt != nil && (current["saved_filename"] != receipt["saved_filename"] || current["size"] != receipt["size"]) {
			t.Fatal("receipt changed")
		}
		receipt = current
	}
	status := httptest.NewRecorder()
	h.ServeHTTP(status, httptest.NewRequest("GET", "/api/upload/status/"+info.SessionID, nil))
	if status.Code != 200 || !strings.Contains(status.Body.String(), `"status":"success"`) {
		t.Fatalf("completion status: %d %s", status.Code, status.Body.String())
	}
	files, _, err := s.ListFiles()
	if err != nil || len(files) != 1 {
		t.Fatalf("duplicate files: %v %v", files, err)
	}
}
