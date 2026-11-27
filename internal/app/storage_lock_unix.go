//go:build linux || darwin || freebsd

package app

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func lockStorage(file *os.File) error {
	err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if errors.Is(err, unix.EWOULDBLOCK) {
		return ErrStorageInUse
	}
	return err
}
