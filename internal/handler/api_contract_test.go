package handler_test

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUploadInitRequiresExplicitSizeWithoutReservingName(t *testing.T) {
	for _, body := range []string{
		`{"filename":"empty.txt"}`,
		`{"filename":"empty.txt","total_size":null}`,
		`{"filename":"empty.txt","total_size":-1}`,
		`{"filename":"empty.txt","total_size":1099511627777}`,
		`{"filename":"empty.txt","total_size":"0"}`,
		`{"filename":"empty.txt","total_size":0} {}`,
		`{"filename":"empty.txt","total_size":0} garbage`,
	} {
		t.Run(body, func(t *testing.T) {
			_, h := setup(t)
			res := post(t, h, "/api/upload/init", "application/json", strings.NewReader(body))
			if res.Code != 400 || !strings.Contains(res.Body.String(), `"code":"INVALID_UPLOAD"`) {
				t.Fatalf("invalid request: %d %s", res.Code, res.Body.String())
			}
			res = post(t, h, "/api/upload/init", "application/json", strings.NewReader(`{"filename":"empty.txt","total_size":0,"future_field":true} `))
			var response struct {
				SessionID     string `json:"session_id"`
				FinalFilename string `json:"final_filename"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if res.Code != 200 || response.FinalFilename != "empty.txt" {
				t.Fatalf("empty file or compatibility broken/name reserved: %d %s", res.Code, res.Body.String())
			}
			res = post(t, h, "/api/upload/complete", "application/json", strings.NewReader(`{"session_id":"`+response.SessionID+`"}`))
			if res.Code != 200 {
				t.Fatalf("complete empty file: %d %s", res.Code, res.Body.String())
			}
			info, err := os.Stat(filepath.Join(h.uploadDir, "empty.txt"))
			if err != nil || info.Size() != 0 {
				t.Fatalf("empty file: %v %v", info, err)
			}
		})
	}
}

func TestSessionMutationsRejectTrailingJSONBeforeSideEffects(t *testing.T) {
	for _, endpoint := range []string{"complete", "cancel"} {
		t.Run(endpoint, func(t *testing.T) {
			_, h := setup(t)
			session := initHTTP(t, h, "empty.txt", 0)
			body := `{"session_id":"` + session.SessionID + `"}`
			for _, suffix := range []string{` {}`, ` null`, ` garbage`, strings.Repeat(" ", 1024)} {
				res := post(t, h, "/api/upload/"+endpoint, "application/json", strings.NewReader(body+suffix))
				want := 400
				if len(body+suffix) > 1024 {
					want = 413
				}
				if res.Code != want {
					t.Fatalf("trailing body: %d %s", res.Code, res.Body.String())
				}
				status := httptest.NewRecorder()
				h.ServeHTTP(status, httptest.NewRequest("GET", "/api/upload/status/"+session.SessionID, nil))
				if status.Code != 200 || !strings.Contains(status.Body.String(), `"status":"uploading"`) {
					t.Fatalf("invalid request mutated session: %d %s", status.Code, status.Body.String())
				}
			}
			res := post(t, h, "/api/upload/"+endpoint, "application/json", strings.NewReader(body+" \n"))
			if res.Code != 200 {
				t.Fatalf("valid session mutation: %d %s", res.Code, res.Body.String())
			}
		})
	}
}

func TestTextEditRejectsTrailingJSONWithoutSaving(t *testing.T) {
	_, h := setup(t)
	path := filepath.Join(h.uploadDir, "file.txt")
	if err := os.WriteFile(path, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	preview := httptest.NewRecorder()
	h.ServeHTTP(preview, httptest.NewRequest("GET", "/api/files/file.txt?preview=info", nil))
	var version struct{ Version string }
	if err := json.Unmarshal(preview.Body.Bytes(), &version); err != nil {
		t.Fatal(err)
	}
	if version.Version == "" {
		t.Fatal("missing version")
	}
	for _, suffix := range []string{` {}`, ` garbage`} {
		res := httptest.NewRecorder()
		req := httptest.NewRequest("PUT", "/api/files/file.txt", strings.NewReader(`{"text":"changed","version":"`+version.Version+`"}`+suffix))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(res, req)
		data, err := os.ReadFile(path)
		if res.Code != 400 || err != nil || string(data) != "original" {
			t.Fatalf("invalid edit changed data: %d %q %v", res.Code, data, err)
		}
	}
}
