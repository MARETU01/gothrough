//go:build !windows && !linux && !darwin && !freebsd

package app

import (
	"errors"
	"os"
)

func lockStorage(*os.File) error { return errors.ErrUnsupported }
