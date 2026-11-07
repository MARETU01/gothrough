# Build and Checks

English | [简体中文](build.zh-CN.md)

[Back to the project README](../README.md)

Run commands from the project root. On Windows, use Git Bash and replace `make` with `mingw32-make` if needed.

## Requirements

- Go: see [go.mod](../go.mod) for the required version.
- Node.js 26.13.0 or a newer 26.x version and npm. The root `.nvmrc` specifies the default version; run `nvm use 26` to select an installed 26.x version.
- GNU Make and a POSIX shell; use Git Bash on Windows.

These tools are needed for development and builds, but not on the deployment machine. See [frontend development](../frontend/README.md#development-and-checks) for running the backend and frontend separately and configuring Vite's proxy.

## Build and Run

```sh
make build

# Windows / Git Bash
./release/gothrough.exe

# Linux / macOS
./release/gothrough
```

Open `http://localhost:8080` by default. The build installs dependencies as needed, generates frontend assets, and compiles Go with `embedweb`. Deploy the executable, external configuration, and any required certificates; Node.js is not needed on the target machine. The application needs read/write access to its data directory. See [configuration](configuration.md) for ports, TLS, and data paths.

The default configuration is copied to `config/config.yaml` under the output directory without overwriting an existing file. Configuration, certificates, and runtime data remain external.

Frontend builds also generate gzip copies of JS/CSS files of at least 1 KiB when compression reduces their size. The embedded server automatically negotiates gzip with browsers and retains the original files for other clients. Compression happens during the build, requires no runtime setting or additional dependency, and reduces network traffic at the cost of a slightly larger executable. Upload and download APIs are unaffected.

| Command | Purpose |
| --- | --- |
| `make` / `make build` | Build the executable with embedded frontend assets |
| `make install` | Download Go modules and install frontend dependencies as needed |
| `make test` | Build the frontend, run frontend tests, and run Go tests and vet with and without embedded assets |
| `make OUTPUT=release/custom.exe` | Set a custom output file path |
| `make OUT_DIR=out` | Change the default output directory |
| `make help` | Show command help |

Override tool commands with `GO` and `NPM`. Cross-compilation uses standard Go environment variables; the output extension follows the target platform:

```sh
GOOS=linux GOARCH=amd64 make build
```

## Dependencies and Embedded Assets

Builds install dependencies automatically. Run `make -B install` after changing Node.js/npm versions or if dependencies are damaged. Do not force installation alongside other builds.

Ordinary `go run ./cmd`, `go test ./...`, and `go build ./...` need no frontend output. Before manually running Go commands with `-tags embedweb`, run `make build` to generate assets. Rebuild after frontend changes.

When adding frontend pages, update the SPA fallback routes in `internal/router/web.go`.

## Checks and Continuous Integration

Run locally:

```sh
make install
npm --prefix frontend run lint
make -j2 build test
```

`make test` includes frontend tests and Go tests and vet with and without embedded assets, so separate runs are unnecessary. With CGO and a C compiler available, also run:

```sh
CGO_ENABLED=1 go test -race -tags embedweb ./...
```

The workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on main pushes, `v*` tags, pull requests, and manual Actions runs. A new run for the same branch cancels the previous run.

| Job | Environment | Checks |
| --- | --- | --- |
| Backend | Ubuntu and Windows, CGO disabled | Ordinary Go tests, vet, builds without embedded assets; Linux also tests image tag rules |
| Frontend and embedded build | Ubuntu, CGO enabled | Frontend lint, tests, build; embedded Go build, tests, vet, and race detection |
| Verify Docker image | Ubuntu, PRs, tags, and manual runs only | amd64 container pages, chunked uploads, download integrity, and restart persistence |
| Publish versioned Docker image | Ubuntu, version tags after checks pass | Publish amd64/arm64 images |

Go uses the version in `go.mod`; Node.js uses 26.x, and dependencies follow the lockfile. On Windows without a C toolchain, run the other checks locally and inspect Linux race results in CI. Image credentials, tag rules, and release steps are documented in [Docker deployment](docker.md#automated-builds-and-publishing-on-github).
