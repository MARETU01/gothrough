//go:build linux || darwin || freebsd

package utils

import (
	"errors"
	"syscall"
)

func storageErrorReason(err error) error {
	switch {
	case errors.Is(err, syscall.ENOSPC), errors.Is(err, syscall.EDQUOT):
		return ErrStorageFull
	case errors.Is(err, syscall.EROFS):
		return ErrStorageReadOnly
	case errors.Is(err, syscall.EXDEV), errors.Is(err, syscall.ENOTSUP):
		return ErrHardlinkUnsupported
	}
	return nil
}
