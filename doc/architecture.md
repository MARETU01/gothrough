# Directories and Layers

English | [简体中文](architecture.zh-CN.md)

[Back to the project README](../README.md)

## Responsibilities

| Location | Responsibility |
| --- | --- |
| `cmd/main.go` | Compose dependencies, run HTTP and cleanup, handle shutdown |
| `internal/config/`, `internal/app/storage.go` | Validate settings, then prepare instance-local storage |
| `internal/router/` | Routes, authentication, and middleware |
| `internal/handler/upload.go` | Upload HTTP protocol and request admission |
| `internal/handler/file_handler.go`, `files.go`, `edit.go`, `selection.go` | File HTTP responses, previews, streaming, and JSON/ETag caching |
| `internal/service/file_service.go` | Coordinate file mutations and shared state |
| `internal/service/upload_session.go`, `completion.go` | Upload sessions, chunks, receipts, and resource release |
| `internal/service/files.go`, `text.go`, `folder*.go`, `selection*.go` | Confined file operations, editing, directory management, and ZIP generation |
| `internal/service/file_listing.go`, `file_browser.go` | Listing generations, directory queries, and disk information |
| `internal/service/clipboard*.go` | Clipboard history, images, and persistence |
| `internal/utils/` | Filename, disk, and platform filesystem operations |
| `frontend/src/features/upload/` | Task state and transfer protocol, independent of React and localization |
| `frontend/src/hooks/useUploadQueue.ts` | Queue scheduling, React snapshots, timing, lifecycle, and notices |

## Startup and Storage

Startup follows `config.Load → app.PrepareStorage → services → handlers → router`. Validate configuration and certificates before preparing or cleaning storage. Pass paths through constructors; `PrepareStorage` runs only at startup.

Services own path validation, `os.Root` confinement, and regular-file checks. Download handlers call the service's `OpenFile`, close its handle, and handle headers, Range, and previews. Upload and file handlers share one `FileService` so publication, reservations, editing, deletion, and directory cleanup remain coordinated.

## Locks and Resource Release

Completion, cancellation, and expiration share resource release. The lock order, when nested, is `session.lifecycle → FileService.mu → session.mu/listingMu`; chunk writers use `lifecycle.RLock → block lock → session.mu`. Lookups release the service lock before taking a lifecycle lock. Listing scans never acquire mutation/session locks. Expiration copies references under the service lock, then uses `lifecycle.TryLock` to avoid waiting for active transfers.

Recursive deletion reserves paths under the same `FileService.mu`, scans/removes descendants outside the lock, and reacquires it for final removal and ancestor cleanup. At most two folders are processed concurrently. Upload initialization, text saves, other deletions, and cleanup consult those reservations; overlapping paths are excluded while unrelated paths proceed. Cancellation/failure releases reservations; path checks and `os.Root` confinement remain intact.

## Queries and HTTP Responses

Services return typed data and a listing generation. `ListingSnapshot` retains an immutable generation without copying entries; `Data()` returns an isolated copy. Unchanged scans retain the generation. Browser queries cache at most 32 pages, retaining only page entries.

`FileHandler` caches JSON and query-specific ETags. Hits skip data materialization; misses encode and hash outside the cache lock. Concurrent misses may duplicate encoding, but old generations cannot overwrite newer cached responses. Validators depend on query and content, so unchanged responses retain their ETag across cache invalidation.

Scans retain native modification times for listing and directory sorting, avoiding repeated RFC3339 parsing inside comparators while preserving HTTP timestamp fields. Disk requests read cached file count/total bytes and query disk space without copying the full file list.

Handlers share storage-error mapping in `errors.go`, with operation-specific fallback codes/messages; full causes stay in logs. Fixed upload limits belong to `service/limits.go`, request body limits to HTTP handlers, and deployment settings to `config/`.

See [Transfer and APIs](transfer.md) for wire formats, limits, and recovery rules.

## Frontend State

The file page shares duplicate-request prevention, per-item result handling, and background resync for single and bulk deletion. Resync failures retain completed-action feedback.

The application-level Provider keeps uploads running across navigation. The queue and engine share `UploadTask`; consumers read its fields and collections, while named lifecycle operations update related fields and notify together. Byte progress is throttled, acknowledgements notify immediately, and clock/speed samples are batched for React snapshots.

Retain late initialization receipts for cancellation cleanup. Uncertain completion retries the original session without re-uploading. The Hook owns React updates, timing, notices, and unmount handling. See [frontend development](../frontend/README.md) for entry points and localization, and [transfer](transfer.md) for protocol and recovery rules.
