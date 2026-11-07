package config

const (
	MaxMultipartMemory        = 50 * 1024 * 1024 // multipart parsing threshold, not a body size limit
	ChunkSize                 = 8 * 1024 * 1024
	MaxUploadSize       int64 = 1 << 40
	MaxConcurrentChunks       = 16
	MaxUploadSessions         = 1024
)
