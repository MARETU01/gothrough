//go:build linux || darwin || freebsd

package utils

import (
	"os"
	"runtime"

	"golang.org/x/sys/unix"
)

func linkInto(source string, directory *os.File, name string) error {
	err := unix.Linkat(unix.AT_FDCWD, source, int(directory.Fd()), name, 0)
	runtime.KeepAlive(directory)
	return err
}
