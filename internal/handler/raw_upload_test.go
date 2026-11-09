package handler_test

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChunkUploadRejectsLegacyOrInvalidContentTypesWithoutWriting(t *testing.T) {
	_, h := setup(t)
	session := initHTTP(t, h, "raw.txt", 5)
	for _, contentType := range []string{"multipart/form-data; boundary=x", "text/plain", "", "application/octet-stream-other", "application/octet-stream; broken"} {
		res := post(t, h, "/api/upload/chunk?session_id="+session.SessionID+"&chunk_index=0", contentType, strings.NewReader("hello"))
		if res.Code != 415 || !strings.Contains(res.Body.String(), `"code":"UNSUPPORTED_UPLOAD_TYPE"`) {
			t.Fatalf("%q: %d %s", contentType, res.Code, res.Body.String())
		}
	}
	status := httptest.NewRecorder()
	h.ServeHTTP(status, httptest.NewRequest("GET", "/api/upload/status/"+session.SessionID, nil))
	var progress struct {
		ReceivedChunks []int `json:"received_chunks"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &progress); err != nil || len(progress.ReceivedChunks) != 0 {
		t.Fatalf("rejected body wrote chunks: %s %v", status.Body.String(), err)
	}
	res := post(t, h, "/api/upload/chunk?session_id="+session.SessionID+"&chunk_index=0", "application/octet-stream; charset=binary", strings.NewReader("hello"))
	if res.Code != 200 {
		t.Fatalf("valid binary upload rejected: %d %s", res.Code, res.Body.String())
	}
}
