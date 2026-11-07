# Transfer and APIs

English | [简体中文](transfer.zh-CN.md)

[Back to the project README](../README.md)

## Upload and File APIs

All backend endpoints use the `/api` prefix.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/upload/init` | Initialize an upload |
| POST | `/api/upload/chunk` | Upload a chunk |
| GET | `/api/upload/status/:session_id` | Query upload progress |
| POST | `/api/upload/complete` | Complete an upload |
| POST | `/api/upload/cancel` | Cancel an upload |
| GET | `/api/files` | List files |
| GET | `/api/files/*filename` | Download a file, with Range request support |
| DELETE | `/api/files/*filename` | Delete a file |
| GET | `/api/disk-info` | Get disk information |

Encode filenames when using them as URL path parameters.

File list `mtime` values use RFC3339 timestamps with timezone offsets. The UI displays them in the viewer's local timezone and selected language, and sorts by the actual instant.

The file list checks for changes 3 seconds after each request; disk information refreshes independently every 15 seconds. Search, sorting, and pagination are preserved. Updates pause during deletion confirmation, deletion requests, and previews/editing, and skip selected text. Hidden pages cancel background requests and refresh immediately when visible again. Each failed poll retains its data and retries without clearing operation errors. Manual refresh and successful edits/deletions immediately refresh both resources. Background reads do not show the foreground loading state.

`GET /api/files?view=list` returns only the file listing and total size with an ETag. Background updates send `If-None-Match` and receive an empty `304` when unchanged. Validators are committed only for accepted responses; cancelled requests cannot advance them. Manual refresh fetches the full listing. The server caches serialized snapshots and reuses them for unchanged scans. Uploads, edits, and deletions invalidate the cache immediately; external changes follow the existing 2-second scan cache. Disk changes do not affect listing validators.

`GET /api/disk-info` independently returns disk capacity, used/free space, `disk_pct`, and `disk_pct_warning`. The original `GET /api/files` retains its combined response for existing clients, without a listing-only ETag. Both resources use `Cache-Control: no-store`.

### File preview

The file list opens previews in a modal, full screen on phones. Close it or press Escape to return to the list. Images, UTF-8 text, PDFs, and browser-supported audio/video are supported, with a download fallback.

Clipboard images use the same preview dialog. Automatic clipboard updates pause while it is open and resume after closing.

`GET /api/files/*filename?preview=info` returns `kind`, `mime_type`, and `text`. The kind is `text`, `image`, `pdf`, `audio`, or `video`; only text previews contain a text body. Text is limited to 1 MiB (413 for oversized files); unsupported types or encodings return 415. HTML, SVG, and source code are displayed as plain text without executing content.

`GET /api/files/*filename?preview=1` serves supported files inline with Range support. Both modes reuse download authentication and path validation and disable caching. Regular downloads retain their existing behavior.

### Text editing

Text previews offer Edit, Save, and Cancel editing. Discarding a modified draft requires confirmation; failed saves preserve the draft. Successful saves refresh file sizes and modification times in the list.

Browser Back/Forward and in-app navigation also block unsaved edits, offering to continue editing or discard. Navigation waits for pending saves. Expired-session drafts stay in page memory and reopen when the user unlocks and returns to the file list, retaining their original version for conflict checks. Drafts are not written to persistent browser storage; refreshing or closing the page still warns about unsaved changes.

Text preview metadata includes `version`. Send `PUT /api/files/*filename` with `{"text":"new content","version":"preview version"}`. Success returns the new version. Missing versions return 428, changed contents return 409, and deleted files return 404. On conflict, copy any draft content you need before reloading; forced overwrites are not offered.

Only supported UTF-8 text files up to 1 MiB after encoding (including BOM and line endings) can be edited. Original BOM and permission bits are preserved. Editors use LF; saves retain the source's first newline style (LF, CRLF, or CR). Unchanged content preserves original bytes, including mixed endings. Writes use a synced temporary file in the same directory before replacement. Version checking and edits/deletes within the service are serialized. Do not run multiple editing services against the same data directory or modify files externally during a save.

All unlocked visitors may edit, following the existing shared access model. When password protection is enabled, PUT requests require a valid session and pass the same-origin checks.

## Clipboard API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/clipboard` | List the latest entries in an `entries` array |
| POST | `/api/clipboard` | Publish text with a JSON body such as `{"text":"shared content"}` |
| DELETE | `/api/clipboard/:id` | Delete one entry |
| DELETE | `/api/clipboard` | Clear all entries |
| GET | `/api/clipboard/image-config` | Get image availability and configured limits |
| POST | `/api/clipboard/image` | Publish a PNG/JPEG using the multipart field `image` |
| GET | `/api/clipboard/:id/image` | Serve the original PNG; `?download=1` downloads it, `?thumbnail=1` serves a thumbnail |

Successful publication returns the created entry. Entries include `id` and `created_at`; `type` identifies the entry type, with a missing value treated as text for compatibility. Text entries contain `text`; image entries contain `image` metadata. Text is treated as plain text, limited to 65,536 UTF-8 bytes per entry. The latest 100 entries across text and images are retained.

Clipboard responses use `Cache-Control: no-store`. Lists provide an `ETag`; `If-None-Match` returns `304` without a body when content is unchanged, or the full list when it changes.

See [configuration](configuration.md#image-clipboard) for image limits, decoding concurrency, and storage recovery rules.

Lists display PNG thumbnails with a maximum edge of 320 pixels; copying and downloading use the original. Thumbnails are cached in memory and released when entries are deleted or evicted. After restart, they are rebuilt on first access and need no separate backup.

## Upload Flow

1. Initialize with the filename, size, and optional `relative_path` to obtain a session, chunk size, and transport mode.
2. Send chunks using the returned size. `upload_transport: "raw"` indicates an `application/octet-stream` request body; use multipart if the server does not advertise this capability. The server also accepts multipart clients.
3. After sending all chunks, call completion. The server validates the file size and chunk completeness before publishing the file. Use the cancellation endpoint to cancel a task.

The frontend retries network and transient server failures at most twice, using backoff and honoring `Retry-After`. Waiting periods above 60 seconds stop automatic retries. Invalid requests and permanent storage errors fail immediately; cancellation interrupts retry waits.

Folder uploads use `relative_path` to preserve the top-level folder and subdirectories, such as `documents/photos/image.jpg`. File listing, downloading, and deletion use paths relative to the upload directory; encode URL path parameters. Empty folders are not preserved. Conflicting names are renamed without overwriting existing content.

## Limits and Errors

| Item | Limit or behavior |
| --- | --- |
| Default transport settings | 8 MiB chunks; frontend sends 3 chunks per file concurrently and processes 2 files at a time |
| File size | Up to 1 TiB |
| Server capacity | Up to 16 concurrent chunk requests and 1024 active sessions; exceeding limits returns 429 |
| Relative paths | Up to 32 components and 4096 bytes; each sanitized component is limited to 200 UTF-8 bytes, including extensions and conflict suffixes |
| Path validation | Absolute paths, traversal, and symlinks are rejected; invalid paths return 400 and parent path conflicts return 409 |
| Storage requirement | Temporary and upload directories must share a filesystem with hard-link support |
| Disk checks | Initialization checks free space without reserving capacity; concurrent uploads may still exhaust it |
| Storage errors | Space or quota exhaustion returns 507, permission errors return 403, and read-only filesystems return 503 |
| Session expiration | Sessions idle for over 24 hours are cleaned up every 5 minutes, except those with active writes |
| Restarts and resuming | Sessions stay in memory; restarting clears temporary uploads and does not support resuming them |
| Downloads | Range requests are supported |
| File list cache | File listings, counts, and totals are cached for 2 seconds and invalidated on upload completion or deletion; external changes appear after expiration, while disk free space is queried live |

For failed requests, use the `X-Request-ID` response header to find server logs. See [troubleshooting](logging.md#troubleshooting).
