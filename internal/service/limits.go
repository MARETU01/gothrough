package service

// Fixed protocol and admission limits, independent of deployment configuration.
const (
	ChunkSize                          = 8 * 1024 * 1024
	MaxUploadSize                int64 = 1 << 40
	MaxConcurrentChunks                = 16
	MaxUploadSessions                  = 1024
	MaxConcurrentFolderDeletions       = 2
)
