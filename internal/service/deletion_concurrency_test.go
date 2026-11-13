package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/MARETU01/gothrough/internal/model"
)

type deletionGateContext struct {
	context.Context
	entered chan struct{}
	release <-chan struct{}
	calls   int
}

func (c *deletionGateContext) Err() error {
	c.calls++
	if c.calls == 2 {
		close(c.entered)
		<-c.release
	}
	return c.Context.Err()
}

func TestRecursiveDeletionAdmissionIsBounded(t *testing.T) {
	s := testService(t)
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	var workers sync.WaitGroup
	finished := make(chan struct{})
	defer func() {
		unblock()
		go func() { workers.Wait(); close(finished) }()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("deletion workers did not finish")
		}
	}()
	for i := 0; i < MaxConcurrentFolderDeletions; i++ {
		name := fmt.Sprintf("folder-%d", i)
		if err := os.Mkdir(filepath.Join(s.uploadDir, name), 0755); err != nil {
			t.Fatal(err)
		}
		ctx := &deletionGateContext{Context: context.Background(), entered: make(chan struct{}), release: release}
		workers.Add(1)
		go func() {
			defer workers.Done()
			results, err := s.DeleteSelection(ctx, []SelectionEntry{{Path: name, Folder: true}})
			if err != nil || len(results) != 1 || results[0].Err != nil {
				t.Errorf("admitted deletion: %+v %v", results, err)
			}
		}()
		select {
		case <-ctx.entered:
		case <-time.After(3 * time.Second):
			t.Fatal("admitted deletion did not start")
		}
	}
	if err := os.Mkdir(filepath.Join(s.uploadDir, "overflow"), 0755); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() {
		entries, err := s.DeleteSelection(context.Background(), []SelectionEntry{{Path: "overflow", Folder: true}})
		if err == nil {
			err = entries[0].Err
		}
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, ErrDeletionBusy) {
			t.Fatalf("admission: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("excess deletion waited instead of rejecting")
	}
}

func TestRecursiveDeletionReservesOnlyItsPathAndReleasesOnCancellation(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		t.Run(fmt.Sprintf("cancel=%t", canceled), func(t *testing.T) {
			s := testService(t)
			if err := os.MkdirAll(filepath.Join(s.uploadDir, "victim"), 0755); err != nil {
				t.Fatal(err)
			}
			for name, content := range map[string]string{"victim/inside.txt": "inside", "outside.txt": "outside"} {
				if err := os.WriteFile(filepath.Join(s.uploadDir, filepath.FromSlash(name)), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			base, cancel := context.WithCancel(context.Background())
			defer cancel()
			release := make(chan struct{})
			ctx := &deletionGateContext{Context: base, entered: make(chan struct{}), release: release}
			result, finished := make(chan error, 1), make(chan struct{})
			go func() {
				defer close(finished)
				results, err := s.DeleteSelection(ctx, []SelectionEntry{{Path: "victim", Folder: true}})
				if err == nil {
					err = results[0].Err
				}
				result <- err
			}()
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer func() {
				unblock()
				select {
				case <-finished:
				case <-time.After(3 * time.Second):
					t.Error("delete goroutine did not finish")
				}
			}()
			select {
			case <-ctx.entered:
			case <-time.After(3 * time.Second):
				t.Fatal("delete did not reach preflight")
			}
			operations := make(chan error, 1)
			go func() {
				operations <- func() error {
					for _, name := range []string{"victim/new.txt", "victim"} {
						_, err := s.InitSession(model.InitRequest{Filename: filepath.Base(name), RelativePath: name})
						if !errors.Is(err, ErrPathDeleting) {
							return fmt.Errorf("overlapping init: %v", err)
						}
					}
					if _, err := s.SaveText("victim/inside.txt", TextVersion([]byte("inside")), "changed"); !errors.Is(err, ErrPathDeleting) {
						return fmt.Errorf("overlapping edit: %v", err)
					}
					if err := s.DeleteFile("victim/inside.txt"); !errors.Is(err, ErrPathDeleting) {
						return fmt.Errorf("overlapping delete: %v", err)
					}
					if _, err := s.SaveText("outside.txt", TextVersion([]byte("outside")), "changed"); err != nil {
						return err
					}
					if err := s.DeleteFile("outside.txt"); err != nil {
						return err
					}
					session, err := s.InitSession(model.InitRequest{Filename: "new.txt", RelativePath: "victim-sibling/new.txt"})
					if err != nil {
						return err
					}
					_, _, err = s.CompleteSession(session.SessionID)
					return err
				}()
			}()
			select {
			case err := <-operations:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("recursive deletion blocked unrelated mutations")
			}
			if canceled {
				cancel()
			}
			unblock()
			err := <-result
			if canceled {
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancel: %v", err)
				}
				if _, err := s.SaveText("victim/inside.txt", TextVersion([]byte("inside")), "after cancellation"); err != nil {
					t.Fatalf("reservation retained: %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			} else if _, err := os.Stat(filepath.Join(s.uploadDir, "victim")); !os.IsNotExist(err) {
				t.Fatalf("folder remains: %v", err)
			}
			s.mu.RLock()
			remaining := len(s.deleting)
			s.mu.RUnlock()
			if remaining != 0 {
				t.Fatal("delete reservation leaked")
			}
		})
	}
}
