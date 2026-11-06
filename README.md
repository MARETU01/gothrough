# GoThrough

English | [简体中文](README.zh-CN.md)

A file upload tool built with Go + Gin and React + TypeScript. The frontend can be embedded in the Go executable for deployment.

## Features

- Concurrent chunked uploads for large files, with drag-and-drop support for files and folders, a multi-file queue, pause, resume, cancel, and retry.
- Folder uploads preserve the top-level folder and subdirectory structure. The file list shows relative paths and supports individual downloads and deletion.
- Upload speed, progress, estimated time remaining, and elapsed time excluding pauses.
- Uploads continue while navigating within the app. The browser warns before leaving when tasks are unfinished.
- File search, sorting, pagination, downloads, deletion confirmation, and disk space information.
- Shared text clipboard: publish, view, copy, and delete text across devices while preserving line breaks. Each entry supports up to 64 KiB; the latest 100 entries are retained across restarts.
- Image clipboard: paste a screenshot or select a PNG/JPEG, preview it, and publish it for viewing, downloading, or copying across devices. Images are stored as PNG.
- HTTP and HTTPS support, with the listening address, port, and certificate paths configurable through YAML and environment variables.
- Text or JSON logs, request IDs, optional rotating log files, and controls for access logs and frequent requests.
- Separate frontend and backend development, or deployment as a single executable with embedded frontend assets.

## Requirements

- Go: see [go.mod](go.mod) for the required version.
- Node.js 26 LTS (26.13.0 or a newer 26.x version) and npm: required for frontend development and release builds, but not on the deployment machine. The root `.nvmrc` specifies 26.13.0 as the local default; run `nvm use 26` to select an installed 26.x version.
- GNU Make and a POSIX shell: required for the Makefile. On Windows, use Git Bash.

Run the following commands from the project root. If your Windows installation provides `mingw32-make`, use it in place of `make`.

## Quick Start

### Local Development

Start the backend:

```sh
go run ./cmd
```

Start the frontend in another terminal:

```sh
make install
npm --prefix frontend run dev
```

Open the development URL printed by Vite. The backend listens on `http://localhost:8080` by default, and the frontend development server proxies `/api` requests to it.

### Build and Run

```sh
make build
```

Start the generated executable:

```sh
# Windows / Git Bash
./release/gothrough.exe

# Linux / macOS
./release/gothrough
```

Open `http://localhost:8080` by default. The frontend is embedded in the executable, so deployment does not require the frontend source, `dist`, or `node_modules`.

Runtime configuration lives in an external `config/config.yaml` file. The build copies the default configuration to `release/config/config.yaml` without overwriting an existing file. See the [configuration guide](doc/configuration.md) for the listening address, port, TLS, and environment variables.

## Common Commands

| Command | Purpose |
| --- | --- |
| `make` / `make build` | Install dependencies as needed, build and embed the frontend, and produce the executable |
| `make install` | Download Go modules and install frontend dependencies as needed |
| `make test` | Build embedded assets and run backend tests and vet with and without embedded assets |
| `make help` | Show available build commands |

See [build and deployment](doc/build.md) for build caching, custom output paths, and cross-compilation.

## Project Structure

```text
cmd/                    Go entry point
config/                 External configuration files
doc/                    Project documentation
frontend/               React frontend
internal/config/        Configuration loading and validation
internal/handler/       HTTP handlers
internal/model/         Data models
internal/router/        API and frontend asset routing
internal/service/       Upload sessions and file services
internal/utils/         Filename, path, and disk utilities
internal/webassets/     Embedded frontend assets
Makefile                Development checks and release builds
```

`release/`, frontend build output, copied embedded assets, and default runtime data are excluded from Git. Set the data root through `storage.data_dir` or `GOTHROUGH_DATA_DIR`. With the default configuration, development data lives in the project root and release data lives next to the executable. See the [configuration guide](doc/configuration.md) for custom path resolution rules.

## Shared Clipboard

Add an image through the file picker or paste a screenshot with Ctrl+V / ⌘V on the clipboard page. Text and images share the publish button: when an image is selected, publishing sends the image and preserves the text draft; remove the image to publish text. Uploads happen only when you click publish. The app does not automatically read or publish the system clipboard. Failed publishing preserves the draft. Published images can be opened, downloaded, or copied. Direct image copying requires a browser with `ClipboardItem` support, HTTPS or localhost, and clipboard permission. A manual fallback is provided when direct copying is unavailable.

The server accepts only PNG/JPEG images that can be fully decoded and converts them to PNG, removing source metadata, including JPEG EXIF orientation. By default, both the input and the converted PNG must be no larger than 10 MiB, images are limited to 20 million pixels, and retained images may total up to 200 MiB. Images are also rejected if conversion makes the PNG exceed the size limit. When the quota is full, delete older images before publishing more. The latest 100 entries are retained across text and images combined; deletion, clearing, and automatic eviction also remove the corresponding image files.

Images are stored in `clipboard/images/` under the data root. `history.json` stores only text and image metadata; conditional list refreshes do not transfer image binaries. Existing text history needs no manual migration. At startup, the server checks that images exist and match their metadata. Missing or visibly damaged images cause startup to fail while preserving the history. After valid history loads, unreferenced application-owned image files are removed. Back up and restore the entire `clipboard/` directory together. Disabling image publishing stops new image uploads; existing images can still be viewed, copied, and deleted.

Image endpoints: `GET /api/clipboard/image-config` returns the limits; `POST /api/clipboard/image` publishes one image using the multipart field `image`; `GET /api/clipboard/:id/image` serves the PNG, with `?download=1` to download it. Image responses use `Cache-Control: no-store`.

Open the clipboard page (`/clipboard`) from the navigation, enter or paste text, and click publish. Another device accessing the same server can view, copy, or delete entries. While the page is visible, it fetches updates automatically, waiting 3 seconds after each request completes. You can also refresh manually. The delete-all action clears all shared entries. Both individual deletion and clearing require confirmation; clearing does not affect unpublished drafts.

Automatic updates pause during publishing, deletion, deletion confirmation, and copying, and resume after the manual copy panel closes. Updates also pause while the page is hidden and run immediately when it becomes visible again. Leaving the page clears timers and cancels requests. If an automatic update fails, the current content remains visible and the app retries later. Updates do not clear action error messages, modify drafts, or automatically write to the system clipboard.

Entries appear newest first. Each text entry is limited to 65,536 UTF-8 bytes, and entries beyond the latest 100 are automatically evicted. Only plain text is stored; HTML is displayed as text. Text history is saved in `clipboard/history.json` under the data root, separately from uploaded files, and does not appear in the file list. In Docker, it lives at `/data/clipboard` in the existing data volume.

One-click text copying requires clipboard permission and a secure context, usually HTTPS or localhost. When using a LAN HTTP address or when permission is denied, the page shows selected text for manual copying with keyboard shortcuts or a long press. The input also supports pasting directly.

The clipboard uses shared access: anyone who can reach the server can view, publish, and delete entries. If the history file is corrupted, startup fails and preserves the original file rather than overwriting it. Each data directory must be used by only one server process.

Text endpoints are `GET /api/clipboard` (returns an `entries` array), `POST /api/clipboard` (accepts a JSON body such as `{"text":"shared content"}` and returns the created entry), `DELETE /api/clipboard/:id` (deletes one entry), and `DELETE /api/clipboard` (clears all entries). Each text entry includes `id`, `text`, and `created_at`. Clipboard responses use `Cache-Control: no-store`.

List responses include an `ETag` content version. Automatic updates send `If-None-Match`: unchanged content returns `304` without a list body, preserving the current view; changed content returns the full list and a new version. The version is kept only in memory alongside the current page data, without persistent local caching. Initial loading, manual refreshes, and synchronization after publishing, deletion, or clearing fetch the full list. The polling interval is unchanged; conditional requests reduce repeated transfer and parsing rather than providing real-time push updates.

## Documentation

All guides are available in English, with links to their Chinese versions at the top of each page.

| Guide | Contents |
| --- | --- |
| [Configuration](doc/configuration.md) | YAML, environment variables, configuration precedence, certificate paths, and development proxy |
| [Logging](doc/logging.md) | Log levels, request correlation, access log filtering, rotating files, and Docker logs |
| [Build and Deployment](doc/build.md) | Makefile, dependency caching, frontend embedding, releases, and cross-compilation |
| [Transfer Implementation](doc/transfer.md) | Chunk protocol, concurrency, temporary files, validation, and resource limits |
| [Continuous Integration](doc/ci.md) | GitHub Actions checks, race detection, and running checks locally |
| [Docker Deployment](doc/docker.md) | Image builds, Compose, persistent data, and HTTPS |
| [Frontend](frontend/README.md) | Frontend development, code organization, and testing |

## Limitations

- Temporary uploads and published files must be on the same filesystem, with hard-link support.
- Uploads cannot resume after a browser refresh or server restart. Temporary uploads are cleaned up at server startup.
- Folder uploads transfer files only; empty folders are not preserved. Conflicting file paths are renamed automatically without overwriting existing files.
- User authentication, per-user file isolation, and folder downloads as archives are not currently supported.

## License

[MIT](LICENSE)
