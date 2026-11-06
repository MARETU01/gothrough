# Server and Data Directory Configuration

English | [简体中文](configuration.zh-CN.md)

[Back to the project README](../README.md)

Run all commands on this page from the project root. Runtime configuration is stored in `config/config.yaml`.

## Configuration File

The external `config/config.yaml` file:

```yaml
storage:
  data_dir: ".."
server:
  host: "0.0.0.0"
  port: 8080
  tls:
    enabled: false
    cert_file: "certs/server.crt"
    key_file: "certs/server.key"
```

Relative certificate paths are resolved from the directory containing the configuration file. In this example, they refer to `config/certs/server.crt` and `config/certs/server.key`. Certificates and private keys are not embedded in the executable, and `config/certs/` is excluded from Git. Enabling TLS does not automatically change the port to 443; set `server.port` to the desired port, such as 8443. The server starts a single HTTP or HTTPS listener.

Configuration files are selected in this order: the path passed to `-config` → `GOTHROUGH_CONFIG` → `config/config.yaml` beside the executable → `config/config.yaml` under the working directory. If no default configuration file exists, the server uses its built-in HTTP default of `0.0.0.0:8080`. It can also start using environment variables alone. A missing or malformed explicitly selected file causes startup to fail. Unknown YAML fields are rejected so that typos are not silently ignored.

Field precedence is **environment variables > YAML configuration > built-in defaults**. Set TLS through `server.tls.enabled` or `GOTHROUGH_TLS_ENABLED`. An empty environment variable still counts as an explicit override; an empty port or an invalid boolean causes an error.

The `logging` section controls log levels, text or JSON format, successful-request access logs, and optional rotating files. See the [logging guide](logging.md) for settings and environment variables. Relative log file paths are resolved from the data root.

## Data Directory

`storage.data_dir` specifies the data root, containing `uploads/`, `temp_uploads/`, and `clipboard/`. Relative paths are resolved from the configuration file's directory. When no configuration file is loaded, relative paths supplied through environment variables are resolved from the working directory. The default configuration uses `".."`, placing development data in the project root and packaged application data in `release/`.

If neither the configuration file nor the environment specifies a data directory, the executable's directory is used. Paths containing names such as `go-build` or `JetBrains` are no longer used to guess the development environment. When using an older configuration with `go run`, add `storage.data_dir: ".."` or set the environment variable. Empty or whitespace-only data directory values are rejected.

Override the directory with `GOTHROUGH_DATA_DIR`, for example `GOTHROUGH_DATA_DIR="D:/GoThroughData" go run ./cmd` in Git Bash. Changing the directory does not migrate existing data. Stop the server and move the data yourself, or keep using the original directory. Each data root must be used by only one server process.

Initialization errors are returned to the entry point, logged, and followed by process exit. Old upload sessions are cleaned up only after directory creation, storage write checks, and hard-link checks succeed. Read or cleanup failures are reported rather than silently ignored.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `GOTHROUGH_CONFIG` | Configuration file path; overridden by `-config` |
| `GOTHROUGH_DATA_DIR` | Data root; overrides `storage.data_dir` and must not be empty |
| `GOTHROUGH_HOST` | Listening IP address or hostname, without a scheme or port; IPv6 addresses must not include brackets |
| `GOTHROUGH_PORT` | Listening port, from 1 to 65535 |
| `GOTHROUGH_TLS_ENABLED` | Enable or disable TLS; use `true` or `false` |
| `GOTHROUGH_TLS_CERT_FILE` | Path to the PEM certificate chain file |
| `GOTHROUGH_TLS_KEY_FILE` | Path to the PEM private key file |

Relative certificate paths follow the same rules whether supplied through YAML or environment variables. When no configuration file is loaded, they are resolved from the working directory. These variables refer to the process environment; the backend does not automatically load `.env` files.

## Startup Examples

Examples for Git Bash:

```sh
# Override the port while keeping the other configuration settings.
GOTHROUGH_PORT=9000 go run ./cmd

# Select a different configuration file.
./release/gothrough.exe -config ./config/config.yaml

# Enable HTTPS with absolute certificate paths.
GOTHROUGH_PORT=8443 GOTHROUGH_TLS_ENABLED=true \
GOTHROUGH_TLS_CERT_FILE="C:/certs/server.crt" \
GOTHROUGH_TLS_KEY_FILE="C:/certs/server.key" ./release/gothrough.exe
```

Before startup, the server validates the port and listening address and, when TLS is enabled, checks that the certificate and private key can be loaded. Failed validation does not initialize or clean up the upload directory. Restart the process after changing configuration or environment variables; hot reload is not supported.

## Image Clipboard

```yaml
clipboard:
  image:
    enabled: true
    max_size_mb: 10
    max_pixels: 20000000
    max_total_size_mb: 200
```

`max_size_mb` limits both the uploaded image and the normalized PNG (1–50 MiB). `max_pixels` limits width × height (1–40,000,000). `max_total_size_mb` limits the total size of images in history; it must be at least the per-image limit and no more than 10,240 MiB. New images are rejected when the total quota is exceeded; existing history is not automatically cleared. Lowering limits does not delete existing entries. Only one image can be decoded at a time; busy requests return 429. Setting `enabled: false` disables new image publishing without affecting existing images or text features.

The corresponding environment variables are `GOTHROUGH_CLIPBOARD_IMAGE_ENABLED`, `GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB`, `GOTHROUGH_CLIPBOARD_IMAGE_MAX_PIXELS`, and `GOTHROUGH_CLIPBOARD_IMAGE_MAX_TOTAL_SIZE_MB`. The frontend reads the actual limits from the API. Restart the server for configuration changes to take effect.

## Frontend Development Proxy

The Vite development proxy is independent of backend configuration. If the backend moves to port 9000, start the frontend with:

```sh
GOTHROUGH_DEV_API_TARGET=http://127.0.0.1:9000 npm --prefix frontend run dev
```

You can also put this variable in `frontend/.env.local`; restart Vite afterward. The embedded frontend uses same-origin `/api` requests and needs no additional proxy configuration. Certificates and backend environment variables are not sent to the browser.
