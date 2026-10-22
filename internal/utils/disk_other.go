//go:build !windows && !linux && !darwin && !freebsd

package utils

import "errors"

func diskSpace(path string) (total, free, available uint64, err error) {
	return 0, 0, 0, errors.New("disk capacity query is unsupported on this operating system")
}
