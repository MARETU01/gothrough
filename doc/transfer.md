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

## Clipboard API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/clipboard` | List the latest entries in an `entries` array |
| POST | `/api/clipboard` | Publish text with a JSON body such as `{"text":"shared content"}` |
| DELETE | `/api/clipboard/:id` | Delete one entry |
| DELETE | `/api/clipboard` | Clear all entries |
| GET | `/api/clipboard/image-config` | Get image availability and configured limits |
| POST | `/api/clipboard/image` | Publish a PNG/JPEG using the multipart field `image` |
| GET | `/api/clipboard/:id/image` | Serve the PNG; add `?download=1` to download |

Successful publication returns the created entry. Entries include `id` and `created_at`; `type` identifies the entry type, with a missing value treated as text for compatibility. Text entries contain `text`; image entries contain `image` metadata. Text is treated as plain text, limited to 65,536 UTF-8 bytes per entry. The latest 100 entries across text and images are retained.

Clipboard responses use `Cache-Control: no-store`. Lists provide an `ETag`; `If-None-Match` returns `304` without a body when content is unchanged, or the full list when it changes.

See [configuration](configuration.md#image-clipboard) for image limits, decoding concurrency, and storage recovery rules.

## Upload Flow

1. Initialize with the filename, size, and optional `relative_path` to obtain a session, chunk size, and transport mode.
2. Send chunks using the returned size. `upload_transport: "raw"` indicates an `application/octet-stream` request body; use multipart if the server does not advertise this capability. The server also accepts multipart clients.
3. After sending all chunks, call completion. The server validates the file size and chunk completeness before publishing the file. Use the cancellation endpoint to cancel a task.

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

For failed requests, use the `X-Request-ID` response header to find server logs. See [troubleshooting](logging.md#troubleshooting).
