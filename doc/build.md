# Frontend Embedding and Release Builds

English | [简体中文](build.zh-CN.md)

[Back to the project README](../README.md)

Run all commands on this page from the project root. See the [configuration guide](configuration.md) for the listening port and TLS settings.

After installing Go, Node.js 26 LTS (26.13.0 or a newer 26.x version), npm, and GNU Make, run the following from the repository root. On Windows, use Git Bash. The default Make target is also `build`. If you use nvm, run `nvm use 26` first. After upgrading from an older Node.js version, run `make -B install` first to force dependency reinstallation.

```sh
make build
```

The Makefile runs `npm ci` on the first build, after dependency manifests or npm configuration change, or after `node_modules` is removed. Otherwise it reuses installed dependencies, then builds the frontend and compiles Go with the `embedweb` build tag. Any failed step stops the build. The same ordering is preserved with `make -j`. Output defaults to `release/gothrough.exe` on Windows and `release/gothrough` on Linux/macOS. If your Windows Make command is named `mingw32-make`, use it in place of `make`.

The build also copies the default configuration to `config/config.yaml` under the output directory. An existing file is preserved so deployment settings are not overwritten. Configuration files, certificates, and private keys remain external.

Start the application on Windows in Git Bash:

```sh
./release/gothrough.exe
```

On Linux/macOS:

```sh
./release/gothrough
```

Available targets and options:

| Command | Purpose |
| --- | --- |
| `make` / `make build` | Install dependencies as needed, build the frontend, and package the Go executable |
| `make install` | Download Go modules and install frontend dependencies as needed |
| `make test` | Build the frontend, then run backend tests and vet with and without embedded assets |
| `make OUTPUT=release/custom.exe` | Set a custom output file path |
| `make OUT_DIR=out` | Change the default output directory |
| `make help` | Show command help |

The Makefile uses `sh` and POSIX commands throughout; it does not invoke cmd or PowerShell. `make install` runs `go mod download` and, when needed, `npm ci`, preparing dependencies only. `make build` and `make test` install dependencies automatically before building and synchronizing frontend assets. Override the tool commands with `GO` and `NPM`. For cross-compilation, select the target through the standard `GOOS` and `GOARCH` environment variables; the output extension is selected automatically from the Go target platform. For example, in Git Bash, run `GOOS=linux GOARCH=amd64 make build`. These settings apply only to that command.

The dependency installation marker is stored in `frontend/node_modules/.gothrough-deps-installed` and excluded from Git. Timestamps on `package.json`, `package-lock.json`, and an existing `.npmrc` determine whether reinstallation is needed. The first build using this version of the Makefile installs dependencies once. Run `make -B install` to force reinstallation after switching Node.js/npm versions, changing npm environment settings, or suspecting damaged dependencies. Do not run forced installation alongside other build tasks because it removes and recreates `node_modules`.

Frontend source and assets are still rebuilt and fully synchronized, preventing stale output after source files are deleted. TypeScript and Go continue to reuse their own compilation caches. The main speed improvement comes from avoiding repeated dependency installations that can take tens of seconds, while still performing the necessary frontend generation steps.

To set a custom output path:

```sh
make build OUTPUT=release/custom.exe
```

After deployment, open `http://localhost:8080` or the configured backend address. Frontend HTML, JavaScript, and CSS are included in the executable. The deployment machine does not need Node.js or `frontend/dist`. Runtime configuration, TLS certificates, and data are not embedded. The application needs permission to create, read, and write the data root, set through `storage.data_dir` or `GOTHROUGH_DATA_DIR`; see the [configuration guide](configuration.md). The Makefile preserves existing configuration files, and older configuration files remain usable. When developing with `go run`, explicitly set the data directory to avoid storing data beside the temporary executable.

`internal/webassets/embed.go` uses `go:embed all:dist` to embed build output from its own directory. Vite still writes to `frontend/dist`. After building the frontend, the Makefile's internal asset rule fully synchronizes the output into `internal/webassets/dist`, removing old files from that generated directory to prevent stale hashed assets. Both `make build` and `make test` do this automatically. Parallel builds also wait for synchronization before compiling Go. A single `make -j2 build test` invocation builds and synchronizes the frontend only once.

Before manually using `-tags embedweb`, you can run `make test` to generate and validate embedded assets. Compilation fails if the generated assets are missing. After changing the frontend, synchronize and compile again. Both `dist` directories and `release` are excluded from Git, so CI must perform the same build steps.

Gin retains all API routes. GET/HEAD requests that do not match an API route are handled by the embedded asset routing. Page routes such as `/`, `/upload`, and `/files` return the SPA entry point, supporting direct navigation and refreshes. Missing API routes, static assets, and other paths return 404. When adding frontend page routes, also update the page fallback list in `internal/router/web.go`. Hashed Vite assets use long-lived caching; HTML and public assets use `no-cache`.

Ordinary `go run ./cmd`, `go test ./...`, and `go build ./...` commands do not embed pages or require generated `dist` directories. Continue using the Vite development proxy with these commands. Frontend API calls use same-origin `/api` paths, without additional cross-origin configuration.

## Embedded Build Checks

After building and synchronizing the frontend, run the following, or use `make test` to check both the ordinary backend and the embedded build:

```sh
go test -tags embedweb ./...
go vet -tags embedweb ./...
```
