package utils

import (
	"os"
	"path/filepath"
)

// LinkInto publishes to an already opened directory. Never resolve its pathname
// again: an untrusted process may have replaced it with a symlink or junction.
func LinkInto(source string, directory *os.File, name string) error {
	if name == "." || name == "" || filepath.Base(name) != name || !filepath.IsLocal(name) {
		return os.ErrInvalid
	}
	if err := linkInto(source, directory, name); err != nil {
		return &os.LinkError{Op: "link", Old: source, New: name, Err: err}
	}
	return nil
}
