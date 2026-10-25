//go:build embedweb

package webassets

import (
	"embed"
	"io/fs"
)

// Run make web-assets before compiling with -tags embedweb.
//
//go:embed all:dist
var assets embed.FS

func Assets() fs.FS {
	root, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	return root
}
