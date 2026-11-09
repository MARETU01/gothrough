# GoThrough

[![CI](https://img.shields.io/github/actions/workflow/status/MARETU01/gothrough/ci.yml?branch=main&logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/v/tag/MARETU01/gothrough?logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/tags)
[![Go version](https://img.shields.io/github/go-mod/go-version/MARETU01/gothrough?logo=go&style=flat-square)](https://github.com/MARETU01/gothrough/blob/main/go.mod)
[![Docker Image Size](https://img.shields.io/docker/image-size/maretu01/gothrough?sort=semver&arch=amd64&logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![Docker Pulls](https://img.shields.io/docker/pulls/maretu01/gothrough?logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

English | [简体中文](README.zh-CN.md)

A file transfer and shared clipboard tool built with Go + Gin and React + TypeScript, supporting both LAN and public internet deployments. Deploy it as a single executable with the frontend included.

## Features

- Concurrent chunked uploads for large files, file and folder drag-and-drop, multi-file queues, pause, resume, cancellation, and retries.
- Folder uploads preserve directory structure. Browse files with search, sorting, pagination, multi-select ZIP downloads/deletion, and disk space information.
- Share text and images across devices, including screenshot pasting, previews, copying, and downloads. History survives restarts.
- Simplified Chinese and English interface; uploads continue during in-app navigation.
- HTTP / HTTPS, YAML and environment configuration, and text / JSON logs.

## Use Cases

Transfer files across LAN or internet-connected devices, share text and screenshots between phones and computers, or host a sharing service for trusted visitors. For public deployments, enable an [access password](doc/configuration.md#access-password) and use HTTPS.

## Quick Start

Clone the repository and enter the project directory, then choose one of the startup methods below:

```sh
git clone https://github.com/MARETU01/gothrough.git
cd gothrough
```

### Docker Compose

With Docker installed and running:

```sh
docker compose up -d --build
```

Open `http://localhost:9815`. Data is stored in a Docker volume. `docker compose down` stops the service and preserves data; `docker compose down -v` deletes the volume.

See [Docker deployment](doc/docker.md) for pulling images, changing ports, certificates, and volume permissions.

### Build from Source

Install Go, Node.js / npm, and GNU Make. See [build requirements](doc/build.md#requirements) for versions and Windows setup.

```sh
make build

# Linux / macOS
./release/gothrough

# Windows / Git Bash
./release/gothrough.exe
```

Open `http://localhost:9815`. The frontend is included in the executable; Node.js is not needed on the deployment machine. Runtime configuration is in `release/config/config.yaml`. See [configuration](doc/configuration.md) for the listening address, TLS, and data directory.

### Access from Other Devices

On the same LAN, open `http://<server-IP>:9815`. Internet access requires a public endpoint or tunnel and firewall access; a domain is optional. `localhost` works only on the server itself. See [LAN and internet access](doc/configuration.md#lan-and-internet-access).

## Shared Clipboard

Publish text, paste screenshots, or select PNG/JPEG files on the clipboard page for other devices using the same service. The app never automatically reads or publishes the system clipboard. One-click copying requires HTTPS or localhost and browser permission; otherwise copy text manually or download images. See [image limits and backups](doc/configuration.md#image-clipboard) and [clipboard APIs](doc/transfer.md#clipboard-api).

## Limitations

- An optional site-wide password protects access, without separate accounts or per-user file isolation. Unlocked visitors can view, upload, and delete shared content. See [access password](doc/configuration.md#access-password).
- Uploads cannot resume after a browser refresh or server restart. Startup clears temporary uploads.
- Temporary uploads and published files must share a filesystem with hard-link support. In Docker, mount all of `/data` as a single volume.
- Empty folders are not preserved on upload. Download folders and their subfolders as ZIP archives from the file list. Conflicting file paths are renamed without overwriting existing files.

## Documentation

| Guide | Contents |
| --- | --- |
| [Configuration](doc/configuration.md) | Configuration files, environment variables, data directories, and backups |
| [Docker Deployment](doc/docker.md) | Image builds and publishing, Compose, persistence, and HTTPS |
| [Logging](doc/logging.md) | Log configuration, request correlation, and troubleshooting |
| [Build and Checks](doc/build.md) | Development requirements, build commands, tests, and CI |
| [Architecture](doc/architecture.md) | Directory responsibilities, dependencies, and state ownership |
| [Frontend Development](frontend/README.md) | Local development, code entry points, and internationalization |
| [Transfer and APIs](doc/transfer.md) | Upload and clipboard APIs, protocols, and resource limits |

## License

[MIT](LICENSE)
