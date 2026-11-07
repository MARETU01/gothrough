//go:build !windows && !linux && !darwin && !freebsd

package utils

import "os"

func linkInto(source string, directory *os.File, name string) error {
	return ErrHardlinkUnsupported
}
