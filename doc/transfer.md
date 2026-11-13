# Transfer and APIs

English | [简体中文](transfer.zh-CN.md)

[Back to the project README](../README.md)

## Using the UI

- Browse folders with breadcrumbs, search, sorting, and pagination. Search covers all files and shows full paths; clearing it restores the current directory. The URL's `dir` preserves location through reloads and history. Empty directories disappear from the browser, which falls back to a surviving parent. Narrow screens show file cards.
- File lists refresh 3 seconds after each request; disk information refreshes independently every 15 seconds. Updates retain data and filters, pause during deletion confirmation/requests and previews/editing, and skip selected text. Hidden pages cancel background requests and refresh when visible. Failures retain data and action feedback; manual refresh and successful edits/deletions refresh both resources.
- Previews support images, UTF-8 text, PDFs, and browser-supported media, with download fallback. Escape closes the dialog; phones use a full-screen view. Clipboard images share the dialog and pause automatic updates while open.
- Signing out with unfinished uploads requires confirmation. Confirming interrupts transfers and clears the queue; cancelling keeps it running. Refreshing the browser or restarting the server cannot resume uploads.
- Select files/folders to download a ZIP or delete them. Select current page covers at most 20 entries; directory, search, sort, page changes, and manual refresh clear selection. Selection pauses polling. Deletion confirms count, names, and recursive scope; cancellation keeps the selection, and partial failures retain failed items for retry.

## Authentication

All endpoints use `/api`. With password protection enabled, file, upload, disk, and clipboard endpoints require a session; browser mutations also pass same-origin checks. See [access configuration](configuration.md#access-password) for cookies, proxy settings, and login limits.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/status` | Return `enabled` and `authenticated` |
| POST | `/api/auth/login` | Send `{"password":"<password>"}` to obtain a session cookie |
| POST | `/api/auth/logout` | Revoke the current session and clear its cookie |

## Upload and File APIs

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/upload/init` | Initialize an upload |
| POST | `/api/upload/chunk` | Upload a chunk |
| GET | `/api/upload/status/:session_id` | Query progress or a completion receipt |
| POST | `/api/upload/complete` | Validate and publish the file |
| POST | `/api/upload/cancel` | Cancel and clean up a session |
| GET | `/api/files` | List files |
| GET | `/api/files/*filename` | Download or preview; supports Range |
| PUT | `/api/files/*filename` | Save text with a version check |
| GET | `/api/disk-info` | Get disk information |
| GET | `/api/batch-download?path=a&path=docs` | Stream selected files/folders as ZIP |
| POST | `/api/batch-delete` | Delete a selection with per-item results |

URL-encode paths and query parameters in URLs; send literal paths in JSON bodies.

### File queries

`GET /api/files` returns server-paginated data. Omit `view` or set it to `browser`; other values return `400 INVALID_FILE_QUERY`. Query parameters are `dir` (relative directory, default root), `q` (case-insensitive full-path search, up to 1024 bytes), `sort` (default `mtime_desc`), `page` (positive integer, default 1), and `page_size` (1–100, default 20). Sort options are `mtime_asc`, `mtime_desc`, `size_asc`, `size_desc`, `name_asc`, and `name_desc`.

For example, `/api/files?dir=docs&page=2&page_size=20` returns direct children of `docs`, folders first; search spans all directories. Names sort case-insensitively with full-path tie breaking, independent of browser locale. Missing directories fall back to surviving parents; out-of-range pages clamp to the last page.

Required response fields are `files` (`name`, `size`, `size_display`, `mtime`, `folder`, `label`), resolved `directory`, matched `total` and `folder_count`, global `total_files` and `total_size_display`, and `page`, `page_size`, `total_pages`. Timestamps use RFC3339 with timezone offsets; the UI displays local time.

Fetch disk information separately through `GET /api/disk-info`: total, used, and free values/displays, `disk_pct`, `disk_pct_warning`, and upload totals.

Listings use `Cache-Control: no-store` and query-specific ETags. Send `If-None-Match` for the same query; unchanged content returns an empty `304`. Reuse only accepted validators; manual refresh fetches full data. Uploads, edits, and deletions invalidate caches; external changes appear after the 2-second scan cache expires. Disk changes do not affect ETags. See [cache architecture](architecture.md#queries-and-http-responses).

### Bulk operations

All deletion uses `POST /api/batch-delete`; a single item also uses the array: `{"entries":[{"path":"docs","folder":true},{"path":"note.txt","folder":false}]}`. Limit: 100 entries and a 512 KiB body. Invalid paths or duplicate selections return `400 INVALID_FILE_SELECTION` before any deletion.

Valid requests return HTTP `200` with a `results` array. Each item contains `path` and `deleted`; failed items add `code` and `error`. Even single-item callers must check the matching result's `deleted` flag: missing entries use `FILE_INACCESSIBLE`, changed types `SELECTION_CHANGED`, and folders containing unfinished uploads `FOLDER_BUSY`. Other entries continue.

`folder: true` recursively deletes descendants. Symlinks and special entries fail that item and are never followed. Neither batches nor individual recursive deletions are atomic; deleted content is not rolled back. Refresh to inspect failures before retrying.

At most two recursive folder deletions run concurrently; excess items return `DELETION_BUSY` while the batch HTTP status remains 200. Deleting paths are reserved: overlapping upload initialization or text saves return `409 PATH_BUSY`, and deletion items return `PATH_BUSY`. Unrelated paths remain usable; cancellation or failure releases reservations.

### Folder ZIP downloads

`GET /api/batch-download?path=a.txt&path=docs` selects 1–100 files or folders inside uploads; use the same endpoint for one folder. Query strings are limited to 64 KiB; selecting the upload root is unsupported. All top-level paths are validated before the response starts.

Archives are named `files.zip` and retain full upload-relative paths, deduplicating parent/child overlap. Folders include their hierarchy regardless of search or pagination, including existing empty subdirectories. Symlinks and special entries are not followed or archived.

ZIPs stream directly without temporary archives, Range support, or source snapshots. Avoid changing source files during download; read failures/disconnects abort the stream and require a retry. At most two ZIPs run concurrently and also consume the shared 32 download slots; excess requests return `429`.

### File preview

`GET /api/files/*filename?preview=info` returns `kind` (`text`, `image`, `pdf`, `audio`, or `video`), `mime_type`, and `text`; text results also include `version`. Text is limited to 1 MiB (413 when exceeded); unsupported types/encodings return 415. HTML, SVG, and code render as plain text without execution.

`?preview=1` serves supported content inline with Range. Both modes reuse download authentication/path checks and disable caching.

### Text editing

Send `PUT /api/files/*filename` with `{"text":"new content","version":"<preview version>"}`. Success returns the new `version`; a missing version returns 428, changed contents 409, and a deleted file 404. Conflicts retain drafts and offer no forced overwrite.

Edits support UTF-8 text up to 1 MiB after encoding, including BOM and line endings. Saves preserve BOM, permissions, and the original first newline style (LF, CRLF, or CR); unchanged text preserves all original bytes. Replacement is atomic, with version checks serialized against in-service edits/deletes. Use one server per data directory and avoid external writes during saves.

Unsaved edits require confirmation before discarding or navigating; navigation waits for pending saves. Failed saves retain drafts. Expired-session drafts remain in page memory and reopen after unlocking with their original version. Refreshing/closing warns about unsaved changes but does not persist drafts.

## Clipboard API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/clipboard` | Return newest-first `entries` |
| POST | `/api/clipboard` | Publish text: `{"text":"shared content"}` |
| DELETE | `/api/clipboard/:id` | Delete one entry |
| DELETE | `/api/clipboard` | Clear all entries |
| GET | `/api/clipboard/image-config` | Get image availability and limits |
| POST | `/api/clipboard/image` | Publish PNG/JPEG using multipart field `image` |
| GET | `/api/clipboard/:id/image` | Original PNG; `?download=1` downloads, `?thumbnail=1` serves a thumbnail |

Publication returns the created entry with `id`, `created_at`, and an explicit `type` (`text` or `image`). Text entries contain `text`; image entries contain `image` metadata. The latest 100 entries are retained; each text entry supports 65,536 UTF-8 bytes. Responses use `Cache-Control: no-store`; lists support ETag/`If-None-Match` and empty `304` responses.

PNG thumbnails have a maximum edge of 320 pixels; copying/downloading uses originals. Thumbnail caches are released on deletion/eviction and rebuilt after restart. See [image configuration](configuration.md#image-clipboard) for limits, persistence, and recovery.

When existing clipboard history omits text entry types, the server normalizes them to `type: "text"` in memory without rewriting history at startup. The next normal mutation saves explicit types. IDs, contents, and creation times are preserved; responses always include explicit types.

## Upload Flow

1. Initialize with a filename, size, and optional `relative_path`, obtaining a session and chunk size.
2. Send chunks as `application/octet-stream`, with `session_id` and zero-based `chunk_index` query parameters. Multipart chunks are unsupported and return `415 UNSUPPORTED_UPLOAD_TYPE`; always use the initialization response's `chunk_size`.
3. After all chunks, call completion to validate size/completeness and publish. Use cancellation to abandon the session.

Example JSON bodies and selected response fields (`<UUID>` is the returned session ID):

| Operation | Request body | Response fields |
| --- | --- | --- |
| Initialize `note.txt` | `{"filename":"note.txt","total_size":5}` | `{"session_id":"<UUID>","chunk_size":8388608,"total_chunks":1,"final_filename":"note.txt"}` |
| Complete | `{"session_id":"<UUID>"}` | `{"status":"success","saved_filename":"note.txt","size":5}` |

The frontend retries transient failures at most twice with backoff and `Retry-After`; waits above 60 seconds stop automatic retries. Permanent request/storage errors fail immediately, and cancellation interrupts waits. Chunk and completion requests have no frontend timeout.

Completion is idempotent: up to 4096 receipts survive for up to one hour, retaining no payload/chunk maps. Repeating completion or status queries returns the original filename/size with `status: "success"`, even if the file was later deleted; it never recreates the file. Receipts are lost on restart.

After a transient completion failure, the frontend checks status before retrying; manual retry keeps the original session without re-uploading. If the receipt expired or the server restarted, check the file list before starting again. Folder uploads use `relative_path` (for example `docs/photos/image.jpg`); empty folders are omitted and conflicting names are renamed without overwrite.

## Limits and Errors

JSON mutations (login, upload initialization/completion/cancellation, text editing, clipboard text, and batch deletion) reject unknown fields and require exactly one JSON value. Trailing whitespace is allowed within the body limit; extra JSON or malformed trailing content is rejected before mutation. Login bodies are limited to 2 KiB and return 413 when exceeded. Upload initialization requires an explicit integer `total_size` from 0 to 1 TiB: missing or `null` is invalid, while `0` uploads an empty file.

| Item | Limit or behavior |
| --- | --- |
| Default transport | 8 MiB chunks; frontend runs 3 chunks/file and 2 files concurrently |
| File size | Up to 1 TiB |
| Upload JSON | Init: 64 KiB body, original filename up to 4096 UTF-8 bytes. Complete/cancel: 1 KiB body, canonical UUID |
| Server capacity | 16 concurrent chunks and 1024 active sessions; excess returns 429 |
| Relative paths | At most 32 components/4096 bytes; sanitized components up to 200 UTF-8 bytes including extension/conflict suffix |
| Path checks | Reject absolute paths, traversal, and symlinks; invalid path: 400, parent conflict: 409 |
| Storage | Temp and published files share a filesystem with hard-link support; init checks free space without reserving it |
| Storage errors | Space/quota exhaustion: 507, permission: 403, read-only: 503 |
| Session expiration | Every 5 minutes, release sessions idle for over 24 hours; skip active writes |
| Directory cleanup | Failed init, cancellation, expiry, and deletion remove only empty service-created ancestors; preserve pre-existing/active directories |
| Restarts | Sessions are in memory; startup clears temporary uploads, with no resume |
| Downloads | Files/previews/clipboard images share 32 slots (429 when full); 30-second write-idle deadline, refreshed on progress, without a fixed total duration |

Error responses provide stable `code` and public `error` fields. Use `X-Request-ID` to find the full cause in [server logs](logging.md#troubleshooting).

Deletion maps permission failures to `STORAGE_PERMISSION` (403), read-only storage to `STORAGE_READ_ONLY` (503), and space/quota exhaustion to `STORAGE_FULL` (507). Batch failures carry codes inside their per-item results while the valid batch request still returns 200. Unknown failures retain operation-specific fallback codes and never expose filesystem details.
