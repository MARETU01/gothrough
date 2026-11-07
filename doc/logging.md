# Logging

English | [简体中文](logging.zh-CN.md)

[Back to the project README](../README.md)

The backend writes text logs to standard output by default, with optional JSON formatting and rotating files.

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
- `log_polling`: whether to log successful file list, disk information, clipboard list, and upload status requests. Disabled by default; failed requests are still logged at the configured levels.
- `log_chunks`: whether to log successful chunk requests. Disabled by default. Failed high-frequency requests are still logged.
- `file.enabled`: also write to a rotating file. Disabled by default; console output is always retained.
- `file.path`: relative paths are resolved from `storage.data_dir`; absolute paths are also supported. The file cannot be inside `temp_uploads`, where startup cleanup could delete it.
- `file.max_size_mb`: target size of each file in MiB, from 1 to 1024. A single oversized record remains intact rather than splitting a JSON record.
- `file.max_backups`: retain 1–100 backup files, defaulting to 5, in addition to the current file. Backups are named `gothrough.log.1`, `.2`, and so on, with `.1` being the newest. The oldest files are deleted when the limit is exceeded.

Restart the server for changes to take effect. When file output is enabled, failure to create or open the log file prevents startup. Runtime write or rotation failures report `logging.file_failed` while console output continues.

## Troubleshooting

1. Find the failed request in browser developer tools and copy its `X-Request-ID` response header.
2. Search console output or log files for the matching `request_id` to inspect the status and full error cause. API responses provide public messages; system paths and other details are available in logs.
3. For uploads, search by `session_id` to trace related events; chunk requests also have `chunk_index`. Clipboard operations can be correlated by `entry_id`.

Access logs include `method`, `route`, `status`, `duration_ms`, `remote_ip`, and `response_bytes`. `remote_ip` comes from the TCP connection and is usually the proxy address behind a reverse proxy. The server generates a new ID for each request.

Logs do not deliberately record file contents, clipboard text, or Authorization headers. File events may include relative filenames, and storage errors may include disk paths; review these fields before sharing logs.

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
