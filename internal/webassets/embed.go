//go:build embedweb

package webassets

import (
	"embed"
	"io/fs"
)

// Run make build or make test to generate the embedded frontend assets.
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
