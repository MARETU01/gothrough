package utils

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func linkInto(source string, directory *os.File, name string) error {
	// Preserve os.Link's support for long paths, including UNC storage roots.
	absolute, err := filepath.Abs(source)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(absolute, `\\?\`) {
		if strings.HasPrefix(absolute, `\\`) {
			absolute = `\\?\UNC\` + absolute[2:]
		} else {
			absolute = `\\?\` + absolute
		}
	}
	path, err := windows.UTF16PtrFromString(absolute)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(path, windows.FILE_WRITE_ATTRIBUTES|windows.SYNCHRONIZE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	// FILE_LINK_INFORMATION uses a UTF-16 name relative to RootDirectory.
	// ReplaceIfExists stays zero so publication never overwrites existing data.
	var info struct {
		ReplaceIfExists byte
		RootDirectory   windows.Handle
		FileNameLength  uint32
		FileName        [260]uint16
	}
	encoded, err := windows.UTF16FromString(name)
	if err != nil {
		return err
	}
	if len(encoded) > len(info.FileName) {
		return windows.ERROR_FILENAME_EXCED_RANGE
	}
	info.RootDirectory = windows.Handle(directory.Fd())
	info.FileNameLength = uint32((len(encoded) - 1) * 2)
	copy(info.FileName[:], encoded)
	// Native FileLinkInformation is 11 (the extended variant uses another class).
	err = windows.NtSetInformationFile(handle, &windows.IO_STATUS_BLOCK{}, (*byte)(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), 11)
	runtime.KeepAlive(directory)
	if status, ok := err.(windows.NTStatus); ok {
		return status.Errno()
	}
	return err
}
