package handler

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/MARETU01/gothrough/internal/service"
)

// FileHandler owns file HTTP responses. UploadHandler shares its coordinator,
// but neither handler owns filesystem policy or mutation locks.
type FileHandler struct {
	files     *service.FileService
	mu        sync.Mutex
	version   uint64
	responses map[string]fileResponse
}

type fileResponse struct {
	body []byte
	etag string
}

func NewFileHandler(files *service.FileService) *FileHandler {
	return &FileHandler{files: files, responses: make(map[string]fileResponse)}
}

// Reuse responses by listing generation/query; encode misses outside the lock.
// Concurrent misses may encode twice, but cannot replace a newer generation.
func (h *FileHandler) encodeListing(key string, version uint64, value func() any) (fileResponse, error) {
	h.mu.Lock()
	if version > h.version {
		h.version = version
		clear(h.responses)
	}
	if version == h.version {
		if response, ok := h.responses[key]; ok {
			h.mu.Unlock()
			return response, nil
		}
	}
	h.mu.Unlock()
	// Copying and encoding large snapshots must not block other queries/hits.
	body, err := json.Marshal(value())
	if err != nil {
		return fileResponse{}, err
	}
	hash := sha256.New()
	_, _ = hash.Write([]byte(key))
	_, _ = hash.Write(body)
	response := fileResponse{body: body, etag: fmt.Sprintf(`"%x"`, hash.Sum(nil))}
	h.mu.Lock()
	defer h.mu.Unlock()
	if version == h.version {
		if cached, ok := h.responses[key]; ok {
			return cached, nil
		}
		if len(h.responses) >= 33 {
			for key := range h.responses {
				delete(h.responses, key)
				break
			}
		}
		h.responses[key] = response
	}
	return response, nil
}
