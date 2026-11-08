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

The build installs dependencies, generates frontend assets, and compiles Go with `embedweb`. Open `http://localhost:9815`. Deploy the executable, configuration, and certificates with read/write access to the data directory; see [configuration](configuration.md). Deployment needs no Node.js.

The default configuration is copied to `config/config.yaml` under the output directory without overwriting an existing file. Configuration, certificates, and runtime data remain external.

Builds precompress JS/CSS files of at least 1 KiB when gzip saves space. The embedded server negotiates compressed or original assets automatically; no runtime setup is needed.

| Command | Purpose |
| --- | --- |
| `make` / `make build` | Build the executable with embedded frontend assets |
| `make install` | Download Go modules and install frontend dependencies as needed |
| `make test` | Build the frontend, run frontend lint and tests, and run Go tests and vet with and without embedded assets |
| `make test-race` | Build the frontend and run Go race tests with embedded assets; requires a C compiler |
| `make clean` | Remove the current `OUTPUT`, `frontend/dist/`, and `internal/webassets/dist/`; keep configuration, data, and dependencies |
| `make OUTPUT=release/custom.exe` | Set a custom output file path |
| `make OUT_DIR=out` | Change the default output directory |
| `make help` | Show command help |

Run `make clean` separately from builds and tests. To clean a custom output, pass the same `OUTPUT` or `OUT_DIR` used when building.

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
make -j2 build test
```

`make test` covers frontend build/lint/tests and Go tests/vet with and without embedded assets. Browser tests run [separately](../frontend/README.md#browser-workflow-tests). With CGO and a C compiler, also run:

```sh
make test-race
```

The workflow in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on main pushes, `v*` tags, pull requests, and manual Actions runs. A new run for the same branch cancels the previous run.

| Job | Environment | Checks |
| --- | --- | --- |
| Backend | Ubuntu and Windows, CGO disabled | Ordinary Go tests, vet, builds without embedded assets; Linux also tests image tag rules |
| Frontend and embedded build | Ubuntu, CGO enabled | Frontend lint, tests, build; embedded Go build, tests, vet, and race detection |
| Browser workflows | Ubuntu | Playwright with desktop/mobile Chromium and mobile-size WebKit against an isolated Go API and Vite; runs separately from `make test` |
| Verify Docker image | Ubuntu, PRs, tags, and manual runs only | amd64 container pages, chunked uploads, download integrity, and restart persistence |
| Publish versioned Docker image | Ubuntu, version tags after checks pass | Publish amd64/arm64 images |

Go uses the version in `go.mod`; Node.js uses 26.x, and dependencies follow the lockfile. On Windows without a C toolchain, run the other checks locally and inspect Linux race results in CI. Image credentials, tag rules, and release steps are documented in [Docker deployment](docker.md#automated-builds-and-publishing-on-github).

### Targeted checks

For resource-limited machines, reduce frontend test concurrency:

```sh
npm --prefix frontend test -- --maxWorkers=2
```

Measure unchanged listing snapshots and concurrent response encoding:

```sh
go test ./internal/service ./internal/handler -run '^$' -bench 'BenchmarkFileListSnapshot|BenchmarkFileResponseConcurrentMisses' -benchmem
```

These isolate snapshot acquisition and encoding costs; they do not measure disk scans or end-to-end HTTP latency.

## GitHub Releases

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs when a `v*` tag is pushed. The version must follow the Docker version format, such as `v0.0.4` or `v0.0.4-beta.1`, and its commit must already be in remote `main` and contain the release workflow.

The workflow checks the version, lints and tests the frontend, runs Go tests and vet with and without embedded assets, and builds the frontend once. Six parallel Linux jobs then cross-compile with `CGO_ENABLED=0` and `embedweb`:

| Target | Archive |
| --- | --- |
| Windows amd64 / arm64 | `gothrough-<version>-windows-<arch>.zip` |
| Linux amd64 / arm64 | `gothrough-<version>-linux-<arch>.tar.gz` |
| macOS amd64 / arm64 | `gothrough-<version>-darwin-<arch>.tar.gz` |

Each archive contains a directory with the executable and the tracked `config/config.yaml` template. Local runtime configuration is never packaged. Cross-platform builds are compilation checks; this workflow runs tests on Linux, not on every target system.

Actions uploads the archives directly without an extra ZIP wrapper. Shared frontend assets are an internal artifact, excluded from Release downloads.

After all builds pass, the workflow creates a **draft** GitHub Release with generated notes, the six archives, and `SHA256SUMS`. Prerelease tags automatically mark the draft as a prerelease. Only the final job gets `contents: write`; it uses the built-in `GITHUB_TOKEN`, so no additional release secret is required. Repository or organization policy must allow this permission.

For example, after syncing `main` and checking CI, publish an unused tag:

```sh
git tag -a v0.0.4 -m "Release v0.0.4"
git push origin v0.0.4
```

Check the Release workflow in Actions, then open Releases, review the draft notes and downloads, and click **Publish release**. Rerunning the workflow replaces attachments on an existing draft; it refuses to overwrite a published release. Verify downloaded archives with `sha256sum --check SHA256SUMS` from the directory containing all archives.

This workflow runs independently of CI's Docker publishing. Docker images are still published on tag pushes after their own checks, even while the GitHub Release is a draft; a Release draft does not imply Docker publishing has succeeded.
