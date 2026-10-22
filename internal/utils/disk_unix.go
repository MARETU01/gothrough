//go:build linux || darwin || freebsd

package utils

import "syscall"

func diskSpace(path string) (total, free, available uint64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, 0, err
	}
	blockSize := uint64(stat.Bsize)
	return stat.Blocks * blockSize, stat.Bfree * blockSize, uint64(stat.Bavail) * blockSize, nil
}
