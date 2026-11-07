package model

type ClipboardEntry struct {
	ID        string         `json:"id"`
	Type      string         `json:"type,omitempty"`
	Text      string         `json:"text"`
	Image     ClipboardImage `json:"image,omitzero"`
	CreatedAt string         `json:"created_at"`
}

type ClipboardImage struct {
	URL      string `json:"url"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

type ClipboardRequest struct {
	Text string `json:"text"`
}

// 上传会话
type UploadSession struct {
	SessionID        string       `json:"session_id"`
	OriginalFilename string       `json:"original_filename"`
	FinalFilename    string       `json:"final_filename"`
	TotalSize        int64        `json:"total_size"`
	ChunkSize        int64        `json:"chunk_size"`
	TotalChunks      int          `json:"total_chunks"`
	ReceivedChunks   []int        `json:"received_chunks"`
	ChunksDir        string       `json:"chunks_dir"`
	CreatedAt        string       `json:"created_at"`
	ReceivedSet      map[int]bool `json:"-"`
}

func (s *UploadSession) HasChunk(index int) bool {
	return s.ReceivedSet[index]
}

func (s *UploadSession) AddChunk(index int) {
	if !s.ReceivedSet[index] {
		s.ReceivedSet[index] = true
		s.ReceivedChunks = append(s.ReceivedChunks, index)
	}
}

func (s *UploadSession) ReceivedCount() int {
	return len(s.ReceivedSet)
}

// 请求类型
type InitRequest struct {
	Filename     string `json:"filename"`
	RelativePath string `json:"relative_path,omitempty"`
	TotalSize    int64  `json:"total_size"`
}

type SessionRequest struct {
	SessionID string `json:"session_id"`
}

// UploadCompletion is a bounded, immutable receipt for an already published file.
type UploadCompletion struct {
	SessionID        string `json:"session_id"`
	OriginalFilename string `json:"original_filename"`
	SavedFilename    string `json:"saved_filename"`
	Size             int64  `json:"size"`
	CreatedAt        string `json:"-"`
}

// 文件信息
type FileInfo struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	SizeDisplay string `json:"size_display"`
	Mtime       string `json:"mtime"`
}
