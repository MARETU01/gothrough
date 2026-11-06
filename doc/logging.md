# Logging

English | [简体中文](logging.zh-CN.md)

[Back to the project README](../README.md)

The backend uses Go's standard `log/slog` package and writes text logs to standard output by default. Startup events, business events, HTTP requests, and errors share timestamps, levels, messages, and structured fields. Request failure messages in the frontend console are separate from backend logs and are not reported to the server automatically.

## Configuration

```yaml
logging:
  level: "info"
  format: "text"
  access_log: true
  log_polling: false
  log_chunks: false
  file:
    enabled: false
    path: "logs/gothrough.log"
    max_size_mb: 10
    max_backups: 5
```

- `level`: `debug`, `info`, `warn`, or `error`. Only records at or above this level are emitted. `debug` also includes diagnostic events such as idle session scans.
- `format`: `text` for direct reading, or `json` for one JSON record per line, suitable for log collection.
- `access_log`: controls access logs for successful requests. When disabled, failed requests are still logged at WARN (4xx) or ERROR (5xx), subject to `level`. Business events such as completed uploads and clipboard publishing are independent of this setting.
- `log_polling`: whether to log successful clipboard list and upload status requests. Disabled by default.
- `log_chunks`: whether to log successful chunk requests. Disabled by default. Failed high-frequency requests are still logged.
- `file.enabled`: also write to a rotating file. Disabled by default; console output is always retained.
- `file.path`: relative paths are resolved from `storage.data_dir`; absolute paths are also supported. The file cannot be inside `temp_uploads`, where startup cleanup could delete it.
- `file.max_size_mb`: target size of each file in MiB, from 1 to 1024. A single oversized record remains intact rather than splitting a JSON record.
- `file.max_backups`: retain 1–100 backup files, defaulting to 5, in addition to the current file. Backups are named `gothrough.log.1`, `.2`, and so on, with `.1` being the newest. The oldest files are deleted when the limit is exceeded.

Restart the server for changes to take effect. Failed configuration or certificate validation does not create a log file. Errors that occur before logging is initialized use basic text output on the console. With file output enabled, failure to create or open the file prevents startup. If writing or rotation fails at runtime, console logging continues and a `logging.file_failed` event is reported once for each continuous failure period.

## Correlating Requests and Business Events

Each HTTP request receives a new `request_id`, returned in the `X-Request-ID` response header. A client-supplied header of the same name is not used directly. Find the ID in the response headers in your browser's developer tools, then search for the same field in logs to locate related business events and the request result.

Access logs include `method`, `route` (the route template), `status`, `duration_ms`, `remote_ip`, and `response_bytes`, along with a recorded error cause when a request fails. `remote_ip` comes from the TCP connection address. Behind a reverse proxy, it is usually the proxy address; forwarded headers are not used directly.

Upload, file, and clipboard endpoints do not return raw underlying error strings. Internal errors produce concise operation failure messages. Known errors, such as insufficient disk space, storage permission failures, or invalid sessions, retain specific user-facing messages without disk paths or system details from wrapped errors. Full causes are recorded in request logs and can be located through the `X-Request-ID` response header. Failed upload completion responses use the same public message in their `error` and `message` fields.

Upload creation, completion, and cancellation events include `session_id`. Completion also records the file size and session duration in milliseconds, with the start time recorded at second precision. Upload status and chunk requests can be correlated with a valid UUID session ID; chunk requests also record `chunk_index`. Events from background cleanup and server shutdown have no HTTP request ID, but include a session ID or cleanup count.

Clipboard publishing records `entry_id` and `size_bytes`; deletion and clearing record their results. Logs do not deliberately record request bodies, file contents, clipboard text, Authorization headers, complete query strings, or panic values. Panics record the value's type and stack trace. File deletion events may include relative filenames, and storage errors may include disk paths.

Common events include `server.started`, `server.stopping`, `server.stopped`, `server.failed`, `http.request`, `http.panic`, `upload.started`, `upload.completed`, `upload.cancelled`, `upload.expired`, `upload.cleanup_failed`, `clipboard.created`, `clipboard.deleted`, and `clipboard.cleared`.

## Docker and Direct Execution

Docker uses console logs only by default:

```sh
docker compose logs -f --tail=100
```

Compose rotates Docker logs at `10m` per file, retaining up to `3` files. These limits are managed separately from application log file sizes and retention. For machine-readable output, set `GOTHROUGH_LOG_FORMAT=json` without enabling application log files.

When running the executable directly, enabling `logging.file.enabled` writes to `logs/gothrough.log` under the data root by default. New directories use mode 0700 and new files use mode 0600, subject to the operating system and umask. Restarting appends to the existing file. When enabled in Docker, file output defaults to `/data/logs`, persisted in the existing data volume.

## Environment Variables

Environment variables override YAML settings. Empty values are also validated.

| Variable | Configuration field |
| --- | --- |
| `GOTHROUGH_LOG_LEVEL` | `logging.level` |
| `GOTHROUGH_LOG_FORMAT` | `logging.format` |
| `GOTHROUGH_ACCESS_LOG` | `logging.access_log` |
| `GOTHROUGH_LOG_POLLING` | `logging.log_polling` |
| `GOTHROUGH_LOG_CHUNKS` | `logging.log_chunks` |
| `GOTHROUGH_LOG_FILE_ENABLED` | `logging.file.enabled` |
| `GOTHROUGH_LOG_FILE_PATH` | `logging.file.path` |
| `GOTHROUGH_LOG_FILE_MAX_SIZE_MB` | `logging.file.max_size_mb` |
| `GOTHROUGH_LOG_FILE_MAX_BACKUPS` | `logging.file.max_backups` |
