//go:build linux || darwin || freebsd

package utils

import (
	"errors"
	"os"
	"syscall"
	"testing"
)

func TestUnixStorageErrors(t *testing.T) {
	for _, test := range []struct{ cause, reason error }{
		{syscall.ENOSPC, ErrStorageFull}, {syscall.EDQUOT, ErrStorageFull}, {syscall.EROFS, ErrStorageReadOnly},
		{syscall.EXDEV, ErrHardlinkUnsupported}, {syscall.ENOTSUP, ErrHardlinkUnsupported},
	} {
		err := StorageError("存储失败", &os.PathError{Op: "write", Path: "payload", Err: test.cause})
		if !errors.Is(err, test.reason) || !errors.Is(err, test.cause) {
			t.Fatalf("classification: %v", err)
		}
	}
}
