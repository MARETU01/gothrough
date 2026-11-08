package handler

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFileResponsesKeepQueryIdentityAndIgnoreLateGenerations(t *testing.T) {
	h := NewFileHandler(nil)
	old, err := h.encodeListing("old", 1, func() any { return []string{"before"} })
	if err != nil {
		t.Fatal(err)
	}
	current, err := h.encodeListing("list", 2, func() any { return []string{"after"} })
	if err != nil {
		t.Fatal(err)
	}
	// A slow request for the old snapshot may finish after a new one was cached.
	if _, err := h.encodeListing("list", 1, func() any { return []string{"before"} }); err != nil {
		t.Fatal(err)
	}
	again, err := h.encodeListing("list", 2, func() any { return nil })
	if err != nil || string(again.body) != `["after"]` || again.etag != current.etag {
		t.Fatalf("late response replaced current snapshot: %+v %v", again, err)
	}
	other, err := h.encodeListing("browser:other", 2, func() any { return []string{"after"} })
	if err != nil || other.etag == current.etag || old.etag == current.etag {
		t.Fatalf("validator crossed query/content boundaries: %v", err)
	}
}

func TestSlowEncodingDoesNotBlockNewSnapshotsOrOverwriteThem(t *testing.T) {
	h := NewFileHandler(nil)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	type result struct {
		response fileResponse
		err      error
	}
	oldDone := make(chan result, 1)
	go func() {
		response, err := h.encodeListing("list", 1, func() any {
			close(started)
			<-release
			return []string{"old"}
		})
		oldDone <- result{response, err}
	}()
	<-started
	newDone := make(chan result, 1)
	go func() {
		response, err := h.encodeListing("list", 2, func() any { return []string{"new"} })
		newDone <- result{response, err}
	}()
	select {
	case fresh := <-newDone:
		if fresh.err != nil || string(fresh.response.body) != `["new"]` {
			t.Fatalf("new snapshot: %+v", fresh)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("slow encoding blocked another generation")
	}
	unblock()
	old := <-oldDone
	if old.err != nil || string(old.response.body) != `["old"]` {
		t.Fatalf("old snapshot: %+v", old)
	}
	response, err := h.encodeListing("list", 2, func() any {
		t.Fatal("cache hit rebuilt its data")
		return nil
	})
	if err != nil || string(response.body) != `["new"]` {
		t.Fatalf("old encoding replaced new data: %+v %v", response, err)
	}
}

func BenchmarkFileResponseConcurrentMisses(b *testing.B) {
	h := NewFileHandler(nil)
	files := make([]string, 10000)
	for i := range files {
		files[i] = "folder/file.txt"
	}
	var sequence atomic.Uint64
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			if _, err := h.encodeListing(fmt.Sprint(sequence.Add(1)), 1, func() any { return files }); err != nil {
				b.Error(err)
			}
		}
	})
}

func TestFileResponseCacheBoundsConcurrentQueries(t *testing.T) {
	h := NewFileHandler(nil)
	var readers sync.WaitGroup
	for i := range 80 {
		readers.Go(func() {
			if _, err := h.encodeListing(fmt.Sprint(i), 1, func() any { return []int{i} }); err != nil {
				t.Error(err)
			}
		})
	}
	readers.Wait()
	if len(h.responses) > 33 {
		t.Fatalf("unbounded response cache: %d", len(h.responses))
	}
}
