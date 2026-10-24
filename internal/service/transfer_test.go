package service

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

func testService(t testing.TB) *UploadService {
	t.Helper()
	root := t.TempDir()
	s := NewUploadService()
	s.uploadDir = filepath.Join(root, "uploads")
	s.tempDir = filepath.Join(root, "temp")
	if err := os.MkdirAll(s.uploadDir, 0755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func smallSession(t *testing.T, s *UploadService, name string, size int64) *model.UploadSession {
	t.Helper()
	info, err := s.InitSession(model.InitRequest{Filename: name, TotalSize: size})
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := s.lookup(info.SessionID)
	entry.info.ChunkSize = 4
	entry.info.TotalChunks = int((size + 3) / 4)
	result, _ := s.GetSession(info.SessionID)
	return result
}

func TestConcurrentOutOfOrderAndSnapshots(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "test.bin", 11)
	expected := []byte("abcdefghijk")
	var workers sync.WaitGroup
	for _, index := range []int{2, 0, 1} {
		workers.Go(func() {
			end := min((index+1)*4, len(expected))
			if _, err := s.WriteChunk(info.SessionID, index, bytes.NewReader(expected[index*4:end])); err != nil {
				t.Error(err)
			}
		})
	}
	workers.Go(func() {
		for range 30 {
			snapshot, err := s.GetSession(info.SessionID)
			if err != nil {
				t.Error(err)
				return
			}
			snapshot.ReceivedSet[999] = true
		}
	})
	workers.Wait()
	current, err := s.GetSession(info.SessionID)
	if err != nil || current.ReceivedCount() != 3 {
		t.Fatalf("snapshot: %v %v", current, err)
	}
	if info.ReceivedCount() != 0 {
		t.Fatal("initial snapshot mutated")
	}
	name, size, err := s.CompleteSession(info.SessionID)
	if err != nil || size != int64(len(expected)) {
		t.Fatalf("complete: %d %v", size, err)
	}
	got, err := os.ReadFile(filepath.Join(s.uploadDir, name))
	if err != nil || sha256.Sum256(got) != sha256.Sum256(expected) {
		t.Fatalf("content mismatch: %q %v", got, err)
	}
	if _, err := s.GetSession(info.SessionID); !errors.Is(err, ErrSession) {
		t.Fatal("completed session still live")
	}
}

func TestBlockValidationRetryAndMissing(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "retry.bin", 8)
	if _, _, err := s.CompleteSession(info.SessionID); err == nil {
		t.Fatal("accepted missing chunks")
	}
	for _, input := range []string{"abc", "abcde"} {
		if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString(input)); !errors.Is(err, ErrChunk) {
			t.Fatalf("accepted %q: %v", input, err)
		}
	}
	if _, err := s.WriteChunk(info.SessionID, -1, bytes.NewBufferString("abcd")); !errors.Is(err, ErrChunk) {
		t.Fatal(err)
	}
	if _, err := s.WriteChunk(info.SessionID, 2, bytes.NewBufferString("abcd")); !errors.Is(err, ErrChunk) {
		t.Fatal(err)
	}
	if _, err := s.WriteChunk(info.SessionID, 1, bytes.NewBufferString("efgh")); err != nil {
		t.Fatal(err)
	}
	// An overlong block must never overwrite the next acknowledged block.
	_, _ = s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("abcdX"))
	if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("abcd")); err != nil {
		t.Fatal(err)
	}
	if count, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("XXXX")); err != nil || count != 2 {
		t.Fatalf("idempotent retry: %d %v", count, err)
	}
	name, _, err := s.CompleteSession(info.SessionID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(s.uploadDir, name))
	if string(got) != "abcdefgh" {
		t.Fatalf("corrupted: %q", got)
	}
}

func TestNameConflictsNeverOverwrite(t *testing.T) {
	s := testService(t)
	a := smallSession(t, s, "same.txt", 4)
	b := smallSession(t, s, "same.txt", 4)
	if a.FinalFilename == b.FinalFilename {
		t.Fatal("names not reserved")
	}
	if err := os.WriteFile(filepath.Join(s.uploadDir, a.FinalFilename), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, info := range []*model.UploadSession{a, b} {
		if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data")); err != nil {
			t.Fatal(err)
		}
		name, _, err := s.CompleteSession(info.SessionID)
		if err != nil {
			t.Fatal(err)
		}
		if name == a.FinalFilename {
			t.Fatal("overwrote externally created file")
		}
	}
	got, _ := os.ReadFile(filepath.Join(s.uploadDir, a.FinalFilename))
	if string(got) != "original" {
		t.Fatalf("original changed: %q", got)
	}
}

type blockingReader struct {
	started, release chan struct{}
	once             sync.Once
	src              *bytes.Reader
}

func (r *blockingReader) Read(p []byte) (int, error) {
	r.once.Do(func() { close(r.started); <-r.release })
	return r.src.Read(p)
}

func TestCancelWaitsForWriters(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "cancel.bin", 4)
	body := &blockingReader{started: make(chan struct{}), release: make(chan struct{}), src: bytes.NewReader([]byte("data"))}
	writeDone := make(chan error, 1)
	go func() { _, err := s.WriteChunk(info.SessionID, 0, body); writeDone <- err }()
	<-body.started
	cancelled := make(chan error, 1)
	go func() { cancelled <- s.CancelSession(info.SessionID) }()
	select {
	case err := <-cancelled:
		t.Fatalf("cancel raced writer: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(body.release)
	if err := <-writeDone; err != nil {
		t.Fatal(err)
	}
	if err := <-cancelled; err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(info.ChunksDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file left: %v", err)
	}
	if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data")); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
}

func TestEmptyExpiryAndSizeMismatch(t *testing.T) {
	s := testService(t)
	empty := smallSession(t, s, "empty.txt", 0)
	if _, size, err := s.CompleteSession(empty.SessionID); err != nil || size != 0 {
		t.Fatalf("empty: %d %v", size, err)
	}
	info := smallSession(t, s, "invalid.bin", 4)
	_, _ = s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data"))
	entry, _ := s.lookup(info.SessionID)
	if err := entry.file.Truncate(2); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.CompleteSession(info.SessionID); err == nil {
		t.Fatal("accepted corrupted size")
	}
	entry.mu.Lock()
	entry.touched = time.Now().Add(-25 * time.Hour)
	entry.mu.Unlock()
	s.ExpireIdle(24 * time.Hour)
	if _, err := s.GetSession(info.SessionID); !errors.Is(err, ErrSession) {
		t.Fatal("expired session survived")
	}
	for _, id := range []string{"../uploads", "", `..\uploads`} {
		if _, err := s.GetSession(id); !errors.Is(err, ErrSession) {
			t.Fatal(err)
		}
	}
}

func TestDuplicateWritersAndCompleters(t *testing.T) {
	s := testService(t)
	info := smallSession(t, s, "duplicate.bin", 4)
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			if _, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data")); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	results := make(chan error, 2)
	for range 2 {
		wg.Go(func() { _, _, err := s.CompleteSession(info.SessionID); results <- err })
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrSession) {
			t.Error(err)
		}
	}
	if success != 1 {
		t.Fatalf("published %d times", success)
	}
}

func TestStreamLimit(t *testing.T) {
	s := testService(t)
	s.slots = make(chan struct{}, 1)
	info := smallSession(t, s, "limit.bin", 4)
	body := &blockingReader{started: make(chan struct{}), release: make(chan struct{}), src: bytes.NewReader([]byte("data"))}
	done := make(chan error, 1)
	go func() { _, err := s.WriteChunk(info.SessionID, 0, body); done <- err }()
	<-body.started
	_, err := s.WriteChunk(info.SessionID, 0, bytes.NewBufferString("data"))
	close(body.release)
	if !errors.Is(err, ErrBusy) {
		t.Fatalf("expected backpressure: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(s.slots) != 0 {
		t.Fatal("slot leaked")
	}
}

// Disk pipeline comparison, not a network-bandwidth benchmark. Legacy reproduces
// separate chunk writes followed by io.Copy merge; direct additionally fsyncs.
func BenchmarkUploadPipeline(b *testing.B) {
	const chunkSize = 8 << 20
	const blocks = 8
	chunk := bytes.Repeat([]byte{0x5a}, chunkSize)
	for _, parallel := range []int{1, 4} {
		for _, mode := range []string{"legacy", "direct"} {
			b.Run(fmt.Sprintf("%s/workers=%d", mode, parallel), func(b *testing.B) {
				s := testService(b)
				b.SetBytes(chunkSize * blocks)
				b.ReportAllocs()
				b.ResetTimer()
				for range b.N {
					if mode == "direct" {
						info, err := s.InitSession(model.InitRequest{Filename: "bench.bin", TotalSize: chunkSize * blocks})
						if err != nil {
							b.Fatal(err)
						}
						jobs := make(chan int, blocks)
						for i := range blocks {
							jobs <- i
						}
						close(jobs)
						var wg sync.WaitGroup
						for range parallel {
							wg.Go(func() {
								for i := range jobs {
									if _, err := s.WriteChunk(info.SessionID, i, bytes.NewReader(chunk)); err != nil {
										b.Error(err)
									}
								}
							})
						}
						wg.Wait()
						name, _, err := s.CompleteSession(info.SessionID)
						if err != nil {
							b.Fatal(err)
						}
						if err := os.Remove(filepath.Join(s.uploadDir, name)); err != nil {
							b.Fatal(err)
						}
					} else {
						dir, err := os.MkdirTemp(s.tempDir, "legacy-")
						if err != nil {
							if err = os.MkdirAll(s.tempDir, 0700); err != nil {
								b.Fatal(err)
							}
							dir, err = os.MkdirTemp(s.tempDir, "legacy-")
							if err != nil {
								b.Fatal(err)
							}
						}
						jobs := make(chan int, blocks)
						for i := range blocks {
							jobs <- i
						}
						close(jobs)
						var wg sync.WaitGroup
						for range parallel {
							wg.Go(func() {
								for i := range jobs {
									f, err := os.Create(filepath.Join(dir, fmt.Sprint(i)))
									if err != nil {
										b.Error(err)
										return
									}
									_, err = io.Copy(f, bytes.NewReader(chunk))
									closeErr := f.Close()
									if err != nil || closeErr != nil {
										b.Errorf("write: %v %v", err, closeErr)
									}
								}
							})
						}
						wg.Wait()
						out, err := os.Create(filepath.Join(s.uploadDir, "bench.bin"))
						if err != nil {
							b.Fatal(err)
						}
						for i := range blocks {
							f, err := os.Open(filepath.Join(dir, fmt.Sprint(i)))
							if err != nil {
								b.Fatal(err)
							}
							_, err = io.Copy(out, f)
							_ = f.Close()
							if err != nil {
								b.Fatal(err)
							}
						}
						if err := out.Close(); err != nil {
							b.Fatal(err)
						}
						if err := os.RemoveAll(dir); err != nil {
							b.Fatal(err)
						}
						if err := os.Remove(filepath.Join(s.uploadDir, "bench.bin")); err != nil {
							b.Fatal(err)
						}
					}
				}
			})
		}
	}
}
