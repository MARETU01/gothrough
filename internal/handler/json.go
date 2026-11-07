package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
)

type jsonMode uint8

const (
	jsonCompatible jsonMode = iota
	jsonStrict
)

// bindLimitedJSON preserves each endpoint's decoding policy. Compatibility mode
// keeps Gin's binding/validation; strict mode requires exactly one JSON value and
// rejects unknown fields, as the clipboard API has always done.
func bindLimitedJSON(c *gin.Context, target any, limit int64, mode jsonMode) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	if mode == jsonCompatible {
		return c.ShouldBindJSON(target)
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err != nil {
			return err
		}
		return errors.New("只允许一个 JSON 对象")
	}
	return nil
}

func requestTooLarge(err error) bool {
	var tooLarge *http.MaxBytesError
	return errors.As(err, &tooLarge)
}

func invalidJSON(c *gin.Context, err error, code, message string) {
	if requestTooLarge(err) {
		respondError(c, err, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "请求体过大")
		return
	}
	respondError(c, err, http.StatusBadRequest, code, message)
}
