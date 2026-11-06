package utils

import (
	"errors"
	"golang.org/x/sys/windows"
)

func storageErrorReason(err error) error {
	switch {
	case errors.Is(err, windows.ERROR_DISK_FULL), errors.Is(err, windows.ERROR_HANDLE_DISK_FULL), errors.Is(err, windows.ERROR_DISK_QUOTA_EXCEEDED):
		return ErrStorageFull
	case errors.Is(err, windows.ERROR_WRITE_PROTECT):
		return ErrStorageReadOnly
	case errors.Is(err, windows.ERROR_NOT_SAME_DEVICE), errors.Is(err, windows.ERROR_NOT_SUPPORTED), errors.Is(err, windows.ERROR_INVALID_FUNCTION):
		return ErrHardlinkUnsupported
	}
	return nil
}
