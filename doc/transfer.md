# Transfer Implementation

English | [简体中文](transfer.zh-CN.md)

[Back to the project README](../README.md)

## API Routes

All backend endpoints use the `/api` prefix. `/upload` and `/files` are frontend page routes.

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

Encode filenames when using them as URL path parameters. The legacy `/api/uploads/*filename`, `/api/delete/*filename`, and endpoints without the `/api` prefix are no longer available.

## Chunking and Resource Management

Folder drag-and-drop uses the browser's directory entry API to traverse all batches of child entries. Only file metadata is read during traversal; contents are still sent in chunks. Initialization may include `relative_path`, such as `documents/photos/image.jpg`, preserving the top-level dropped folder. The backend rejects absolute paths, directory traversal, paths deeper than 32 components, and paths longer than 4096 bytes. Each component is sanitized and limited to 200 UTF-8 bytes without splitting Unicode characters; extensions and conflict suffixes count toward this limit.

Parent directories are created and checked during initialization. Uploads are rejected immediately if a parent path is already a file, is reserved as a file by another upload session, or contains a symbolic link. Path conflicts return 409; invalid paths return 400. If a file or directory already occupies the final file path, only the new filename is changed, preserving existing content. Parent directories are checked again at completion to account for local filesystem changes after initialization. Cancelling a session may leave empty parent directories; empty directories are not saved as separate uploaded items.

File listings recursively return paths relative to the upload directory. Download and delete endpoints use encoded relative paths, and disk statistics include files in subdirectories. Directory traversal failures are shown on the upload page rather than silently omitting files. Ordinary file drag-and-drop remains available when the browser does not provide the directory entry API.

Uploads use 8 MiB chunks, with 3 concurrent chunk requests per file and 2 files processed at a time. Initialization returns `upload_transport: "raw"`. New frontend clients send the Blob directly as an `application/octet-stream` request body; they use multipart with older servers that do not advertise this capability. Older multipart clients can also use the new backend, provided they use the chunk size returned at initialization.

The backend uses `io.CopyBuffer` and offset writes to stream each chunk directly into the same temporary file, reusing 256 KiB buffers. It does not load whole chunks into memory or reread all chunks for merging. Before completion, it checks the chunk count and file size, calls Sync, and publishes the file through a hard link without overwriting an existing file. Temporary and upload directories must be on the same filesystem with hard-link support, such as the same NTFS or ext4 partition. Startup and session initialization verify write access and hard-link support by briefly creating and removing probe files. Downloads continue to use standard-library file serving with Range request support.

Initialization compares the file size with free space in the temporary directory and returns 507 if space is insufficient. This check does not reserve capacity, so concurrent uploads or other programs may still exhaust disk space. During writing and publication, insufficient disk space or quota returns 507, permission failures return 403, and read-only filesystems return 503. The operation stage and cause remain available for diagnostics. Unsupported hard links produce a specific message about the same-filesystem and hard-link requirements.

Sessions coordinate concurrent writes independently, and duplicate chunks do not overwrite acknowledged data. The server accepts at most 16 chunks concurrently and retains up to 1024 active sessions; exceeding these limits returns 429. The per-file limit is 1 TiB. Every 5 minutes, sessions idle for more than 24 hours are cleaned up; sessions with active writes are skipped. Sessions are stored in memory, and restarting the server clears temporary uploads. Resuming uploads after a restart is not supported.

Routes share structured access logging and panic recovery middleware. Each request returns `X-Request-ID`. Successful chunk and polling requests are not logged individually by default; failed requests retain their error causes, and upload business events include session IDs. See the [logging guide](logging.md) for levels, formats, and optional rotating files. The server sets request header, request body, and idle connection timeouts. At shutdown, it waits up to 30 seconds for existing requests to finish, then closes connections and cleans up temporary sessions.
