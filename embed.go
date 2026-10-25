//go:build embedweb

package gothrough

import (
	"embed"
	"io/fs"
)

// Build the frontend before compiling with -tags embedweb.
//
//go:embed all:frontend/dist
var assets embed.FS

func Assets() fs.FS {
	root, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		panic(err)
	}
	return root
}
