package handler_test

import (
	"strings"
	"testing"
)

func TestUploadJSONBodyLimits(t *testing.T) {
	s, h := setup(t)
	for _, endpoint := range []string{"init", "complete", "cancel"} {
		key := "session_id"
		if endpoint == "init" {
			key = "filename"
		}
		body := "{\"" + key + "\":\"" + strings.Repeat("a", 128*1024) + "\"}"
		res := post(t, h, "/api/upload/"+endpoint, "application/json", strings.NewReader(body))
		if res.Code != 413 {
			t.Fatalf("%s accepted oversized JSON: %d %s", endpoint, res.Code, res.Body.String())
		}
	}
	// A syntactically valid, smaller JSON document must also respect service limits.
	body := `{"filename":"` + strings.Repeat("a", 4097) + `","total_size":0}`
	res := post(t, h, "/api/upload/init", "application/json", strings.NewReader(body))
	if res.Code != 400 {
		t.Fatalf("oversized filename: %d", res.Code)
	}
	if files, _, err := s.ListFiles(); err != nil || len(files) != 0 {
		t.Fatalf("rejected upload left data: %v %v", files, err)
	}
}
