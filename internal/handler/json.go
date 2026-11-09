package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

type jsonMode uint8

const (
	jsonCompatible jsonMode = iota
	jsonStrict
)

// Both modes require exactly one JSON value within the body limit. Compatibility
// mode allows unknown fields and retains Gin validation; strict mode rejects them.
func bindLimitedJSON(c *gin.Context, target any, limit int64, mode jsonMode) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	decoder := json.NewDecoder(c.Request.Body)
	if mode == jsonStrict {
		decoder.DisallowUnknownFields()
	}
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
	if mode == jsonCompatible {
		return binding.Validator.ValidateStruct(target)
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
