# Directories and Layers

English | [简体中文](architecture.zh-CN.md)

[Back to the project README](../README.md)

| Location | Responsibility |
| --- | --- |
| `cmd/main.go` | Load settings, compose dependencies, start HTTP and cleanup, handle shutdown |
| `internal/config/` | Read-only configuration loading, validation, and runtime defaults |
| `internal/app/storage.go` | Prepare directories, probe storage, clean abandoned uploads at startup, return instance-local `StoragePaths` |
| `internal/router/` | Register routes and assemble authentication and middleware |
| `internal/handler/` | Parse requests, map errors, render previews, and stream HTTP responses |
| `internal/service/upload_session.go` | Upload sessions, chunks, completion receipts, and lifecycle |
| `internal/service/files.go`, `text.go` | Relative path policy, confined file opening, deletion, and editing |
| `internal/service/file_listing.go` | File listing cache and disk information |
| `internal/service/clipboard*.go` | Clipboard history, images, and persistence |
| `internal/utils/` | Filename, disk, and platform hard-link operations |
| `frontend/src/features/upload/engine.ts` | Single-file transfer protocol, chunk concurrency, and retries without React |
| `frontend/src/hooks/useUploadQueue.ts` | Queue scheduling, React snapshots, clocks, page lifecycle, and UI messages |

Startup follows `config.Load → app.PrepareStorage → service constructors → handlers → router`. Storage paths are explicit constructor dependencies, never process globals. Call `PrepareStorage` only at startup after configuration validation; it performs filesystem cleanup.

Download handlers obtain files from their service's `OpenFile`, close the returned handle, and handle response headers, Range, and previews. The service owns relative path validation, root confinement, and regular-file checks. Filesystem operations retain `os.Root` and directory-handle protections. Every service instance uses its own directories.

Upload publication, path reservations, directory cleanup, edits, and deletion remain coordinated by the same service. Splitting files or types must not introduce unrelated locks for this shared state. Completion, cancellation, and expiration share resource release; expiration never waits on an active transfer.

The frontend transfer engine reports changes through callbacks. The Hook owns React updates, error presentation, and unmount handling. Keep late initialization receipts so cancelled sessions can be cleaned up. Uncertain completion keeps its original session for confirmation instead of initializing another upload. Transfer logic and cancellation detection do not depend on UI translations.

`config/config.yaml` is the tracked template; `release/config/config.yaml` is local runtime configuration, which builds preserve. `frontend/dist/` and `internal/webassets/dist/` are generated assets. Runtime settings, APIs, UI messages, and data layout remain compatible.
