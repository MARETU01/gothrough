package service

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MARETU01/gothrough/internal/config"
	"github.com/MARETU01/gothrough/internal/model"
	"github.com/MARETU01/gothrough/internal/utils"
	"uuid"
)

func nameKey(name string) string { return strings.ToLower(name) }

var (
	ErrSession       = errors.New("无效或已结束的会话")
	ErrChunk         = errors.New("分块索引或大小无效")
	ErrPath          = errors.New("无效的上传相对路径")
	ErrPathConflict  = errors.New("上传路径与已有文件或目录冲突")
	ErrBusy          = errors.New("服务器上传繁忙，请稍后重试")
	ErrMissingChunks = errors.New("缺少分块")
	transferBuffers  = sync.Pool{New: func() any { b := make([]byte, 256*1024); return &b }}
)

type transferSession struct {
	// Lifecycle excludes complete/cancel from active streams. Different blocks write concurrently.
	lifecycle sync.RWMutex
	mu        sync.Mutex
	blocks    [64]sync.Mutex
	info      model.UploadSession
	file      *os.File
	closed    bool
	touched   time.Time
}

type UploadService struct {
	mu        sync.RWMutex
	sessions  map[string]*transferSession
	names     map[string]bool
	uploadDir string
	tempDir   string
	slots     chan struct{}
	diskUsage func(string) (utils.DiskUsage, error)
}

func NewUploadService() *UploadService {
	return &UploadService{sessions: make(map[string]*transferSession), names: make(map[string]bool),
		uploadDir: config.UploadFolder, tempDir: config.TempFolder, slots: make(chan struct{}, config.MaxConcurrentChunks), diskUsage: utils.GetDiskUsage}
}

func (s *UploadService) InitSession(req model.InitRequest) (*model.UploadSession, error) {
	if req.TotalSize < 0 || req.TotalSize > config.MaxUploadSize || req.Filename == "" {
		return nil, ErrChunk
	}
	safeName := utils.SanitizeFilenameKeepUnicode(req.Filename, utils.MaxFilenameBytes)
	if safeName == "" {
		safeName = "upload_" + uuid.NewV7().String()
	}
	if req.RelativePath != "" {
		var err error
		safeName, err = sanitizeUploadPath(req.RelativePath)
		if err != nil {
			return nil, err
		}
	}

	// Reserve paths and prepare directories together, so a concurrent session
	// cannot reserve a file as another session's parent directory.
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sessions) >= config.MaxUploadSessions {
		return nil, ErrBusy
	}
	for parent := filepath.Dir(filepath.FromSlash(safeName)); parent != "."; parent = filepath.Dir(parent) {
		if s.names[nameKey(filepath.ToSlash(parent))] {
			return nil, fmt.Errorf("%w: %s 已被另一个上传会话用作文件", ErrPathConflict, filepath.ToSlash(parent))
		}
	}
	if err := s.prepareParent(safeName); err != nil {
		return nil, err
	}
	name := safeName
	for {
		_, err := os.Lstat(filepath.Join(s.uploadDir, name))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, utils.StorageError("检查目标文件失败", err)
		}
		if !s.names[nameKey(name)] && errors.Is(err, os.ErrNotExist) {
			break
		}
		name = conflictName(safeName)
	}
	if err := os.MkdirAll(s.tempDir, 0700); err != nil {
		return nil, utils.StorageError("创建临时上传目录失败", err)
	}
	usage, err := s.diskUsage(s.tempDir)
	if err != nil {
		return nil, utils.StorageError("查询可用磁盘空间失败", err)
	}
	if uint64(req.TotalSize) > usage.Free {
		return nil, utils.ErrStorageFull
	}
	if err := utils.CheckStorage(s.tempDir, filepath.Dir(filepath.Join(s.uploadDir, name))); err != nil {
		return nil, err
	}

	id := uuid.NewV7().String()
	dir := filepath.Join(s.tempDir, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		return nil, utils.StorageError("创建上传会话目录失败", err)
	}
	f, err := os.OpenFile(filepath.Join(dir, "payload"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		cleanupErr := os.Remove(dir)
		return nil, errors.Join(utils.StorageError("创建上传临时文件失败", err), utils.StorageError("清理失败的上传会话失败", cleanupErr))
	}
	// No full-file preallocation; capacity is checked but not reserved.
	chunkSize := int64(config.ChunkSize)
	chunks := int(req.TotalSize / chunkSize)
	if req.TotalSize%chunkSize != 0 {
		chunks++
	}
	entry := &transferSession{file: f, touched: time.Now(), info: model.UploadSession{
		SessionID: id, OriginalFilename: req.Filename, FinalFilename: name, TotalSize: req.TotalSize,
		ChunkSize: chunkSize, TotalChunks: chunks, ChunksDir: dir,
		CreatedAt: time.Now().Format(time.RFC3339), ReceivedChunks: []int{}, ReceivedSet: make(map[int]bool),
	}}
	s.names[nameKey(name)] = true
	s.sessions[id] = entry
	return snapshot(entry), nil
}

func conflictName(name string) string {
	dir, base := filepath.Split(filepath.FromSlash(name))
	return filepath.ToSlash(filepath.Join(dir, utils.FilenameWithSuffix(base, "_"+uuid.NewV7().String(), utils.MaxFilenameBytes)))
}

func (s *UploadService) lookup(id string) (*transferSession, error) {
	s.mu.RLock()
	entry := s.sessions[id]
	s.mu.RUnlock()
	if entry == nil {
		return nil, ErrSession
	}
	return entry, nil
}

// A snapshot prevents HTTP encoders and status queries racing live chunk acknowledgements.
func snapshot(entry *transferSession) *model.UploadSession {
	entry.mu.Lock()
	defer entry.mu.Unlock()
	src := entry.info
	src.ReceivedChunks = append([]int{}, entry.info.ReceivedChunks...)
	src.ReceivedSet = make(map[int]bool, len(src.ReceivedChunks))
	for _, index := range src.ReceivedChunks {
		src.ReceivedSet[index] = true
	}
	sort.Ints(src.ReceivedChunks)
	return &src
}

func (s *UploadService) GetSession(id string) (*model.UploadSession, error) {
	entry, err := s.lookup(id)
	if err != nil {
		return nil, err
	}
	entry.lifecycle.RLock()
	defer entry.lifecycle.RUnlock()
	if entry.closed {
		return nil, ErrSession
	}
	return snapshot(entry), nil
}

// WriteChunk streams a bounded block directly to its final offset. Only a fully
// received body with verified EOF is acknowledged. Retries never overwrite an acknowledged block.
func (s *UploadService) WriteChunk(id string, index int, body io.Reader) (int, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	default:
		return 0, ErrBusy
	}
	entry, err := s.lookup(id)
	if err != nil {
		return 0, err
	}
	entry.lifecycle.RLock()
	defer entry.lifecycle.RUnlock()
	if entry.closed {
		return 0, ErrSession
	}
	if index < 0 || index >= entry.info.TotalChunks {
		return 0, ErrChunk
	}
	block := &entry.blocks[index%len(entry.blocks)]
	block.Lock()
	defer block.Unlock()
	expected := min(entry.info.ChunkSize, entry.info.TotalSize-int64(index)*entry.info.ChunkSize)
	entry.mu.Lock()
	received := entry.info.HasChunk(index)
	entry.touched = time.Now()
	entry.mu.Unlock()
	var dst io.Writer = io.NewOffsetWriter(entry.file, int64(index)*entry.info.ChunkSize)
	if received {
		dst = io.Discard
	}
	buffer := transferBuffers.Get().(*[]byte)
	defer transferBuffers.Put(buffer)
	n, err := io.CopyBuffer(dst, io.LimitReader(body, expected), *buffer)
	if err != nil {
		return 0, utils.StorageError("接收或写入分块失败", err)
	}
	if n != expected {
		return 0, ErrChunk
	}
	// Probe without writing past the block boundary, including chunked HTTP requests.
	var extra [1]byte
	nExtra, readErr := io.ReadFull(body, extra[:])
	if nExtra != 0 || readErr != io.EOF {
		return 0, ErrChunk
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	entry.info.AddChunk(index)
	entry.touched = time.Now()
	return entry.info.ReceivedCount(), nil
}

func (s *UploadService) CompleteSession(id string) (string, int64, error) {
	entry, err := s.lookup(id)
	if err != nil {
		return "", 0, err
	}
	entry.lifecycle.Lock()
	defer entry.lifecycle.Unlock()
	if entry.closed {
		return "", 0, ErrSession
	}
	entry.mu.Lock()
	count := entry.info.ReceivedCount()
	entry.mu.Unlock()
	if count != entry.info.TotalChunks {
		return "", 0, fmt.Errorf("%w: 总数=%d, 已收=%d", ErrMissingChunks, entry.info.TotalChunks, count)
	}
	stat, err := entry.file.Stat()
	if err != nil {
		return "", 0, utils.StorageError("读取上传临时文件信息失败", err)
	}
	if stat.Size() != entry.info.TotalSize {
		return "", 0, fmt.Errorf("文件大小校验失败")
	}
	if err := entry.file.Sync(); err != nil {
		return "", 0, utils.StorageError("保存上传文件失败", err)
	}
	// Hard-link publication is atomic and never overwrites an existing file. Both
	// directories must be on the same filesystem (the default configuration is).
	source := filepath.Join(entry.info.ChunksDir, "payload")
	if err := s.prepareParent(entry.info.FinalFilename); err != nil {
		return "", 0, err
	}
	for {
		err = os.Link(source, filepath.Join(s.uploadDir, entry.info.FinalFilename))
		if !errors.Is(err, os.ErrExist) {
			break
		}
		s.mu.Lock()
		delete(s.names, nameKey(entry.info.FinalFilename))
		entry.mu.Lock()
		entry.info.FinalFilename = conflictName(entry.info.FinalFilename)
		s.names[nameKey(entry.info.FinalFilename)] = true
		entry.mu.Unlock()
		s.mu.Unlock()
	}
	if err != nil {
		return "", 0, utils.StorageError("发布上传文件失败", err)
	}
	entry.closed = true
	_ = entry.file.Close()
	s.remove(entry)
	return entry.info.FinalFilename, stat.Size(), nil
}

func (s *UploadService) remove(entry *transferSession) {
	s.mu.Lock()
	delete(s.sessions, entry.info.SessionID)
	delete(s.names, nameKey(entry.info.FinalFilename))
	s.mu.Unlock()
	if err := os.RemoveAll(entry.info.ChunksDir); err != nil {
		// The published file is already durable; stale temporary files are removed at startup.
		log.Printf("清理上传临时文件失败: %v", err)
	}
}

func (s *UploadService) CancelSession(id string) error {
	entry, err := s.lookup(id)
	if err != nil {
		return err
	}
	entry.lifecycle.Lock()
	defer entry.lifecycle.Unlock()
	if entry.closed {
		return ErrSession
	}
	entry.closed = true
	err = entry.file.Close()
	s.remove(entry)
	return err
}

// ExpireIdle is deliberately non-blocking for active streams; their lifecycle
// read lock keeps the payload alive until they finish or disconnect.
func (s *UploadService) ExpireIdle(age time.Duration) {
	s.mu.RLock()
	entries := make([]*transferSession, 0, len(s.sessions))
	for _, entry := range s.sessions {
		entries = append(entries, entry)
	}
	s.mu.RUnlock()
	for _, entry := range entries {
		if !entry.lifecycle.TryLock() {
			continue
		}
		entry.mu.Lock()
		stale := time.Since(entry.touched) > age
		entry.mu.Unlock()
		if stale && !entry.closed {
			entry.closed = true
			_ = entry.file.Close()
			s.remove(entry)
		}
		entry.lifecycle.Unlock()
	}
}

func (s *UploadService) Close() {
	s.mu.RLock()
	ids := make([]string, 0, len(s.sessions))
	for id := range s.sessions {
		ids = append(ids, id)
	}
	s.mu.RUnlock()
	for _, id := range ids {
		_ = s.CancelSession(id)
	}
}
