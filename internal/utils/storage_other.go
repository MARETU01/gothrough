//go:build !windows && !linux && !darwin && !freebsd

package utils

func storageErrorReason(err error) error { return nil }
