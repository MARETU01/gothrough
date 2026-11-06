package utils

import (
	"errors"
	"golang.org/x/sys/windows"
	"os"
	"testing"
)

func TestWindowsStorageErrors(t *testing.T) {
	for _, test := range []struct{ cause, reason error }{
		{windows.ERROR_DISK_FULL, ErrStorageFull}, {windows.ERROR_HANDLE_DISK_FULL, ErrStorageFull},
		{windows.ERROR_DISK_QUOTA_EXCEEDED, ErrStorageFull}, {windows.ERROR_WRITE_PROTECT, ErrStorageReadOnly},
		{windows.ERROR_NOT_SAME_DEVICE, ErrHardlinkUnsupported}, {windows.ERROR_NOT_SUPPORTED, ErrHardlinkUnsupported},
	} {
		err := StorageError("存储失败", &os.PathError{Op: "write", Path: "payload", Err: test.cause})
		if !errors.Is(err, test.reason) || !errors.Is(err, test.cause) {
			t.Fatalf("classification: %v", err)
		}
	}
}
