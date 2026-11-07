# GoThrough

[![CI](https://img.shields.io/github/actions/workflow/status/MARETU01/gothrough/ci.yml?branch=main&logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/v/tag/MARETU01/gothrough?logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/tags)
[![Go version](https://img.shields.io/github/go-mod/go-version/MARETU01/gothrough?logo=go&style=flat-square)](https://github.com/MARETU01/gothrough/blob/main/go.mod)
[![Docker Image Size](https://img.shields.io/docker/image-size/maretu01/gothrough?sort=semver&arch=amd64&logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![Docker Pulls](https://img.shields.io/docker/pulls/maretu01/gothrough?logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[English](README.md) | 简体中文

基于 Go + Gin 和 React + TypeScript 的文件上传与共享剪贴板工具，支持局域网和公网部署，可部署为包含前端的单个可执行文件。

## 功能

- 大文件分块并发上传，支持文件与文件夹拖拽、多文件队列、暂停、恢复、取消和失败重试。
- 文件夹上传保留目录结构；文件列表支持搜索、排序、分页、下载、删除和磁盘空间查看。
- 跨设备共享文本与图片，支持粘贴截图、预览、复制及下载，历史记录在重启后保留。
- 界面支持简体中文与英文；站内切换页面时上传继续进行。
- 支持 HTTP / HTTPS、YAML 与环境变量配置，以及文本 / JSON 日志。

## 适用场景

- 在局域网或通过公网连接的设备之间传输文件和文件夹。
- 在手机与电脑之间共享文本、链接和截图。
- 在家庭服务器或云服务器上搭建文件共享服务，供可信访问者使用。

服务采用共享访问模式，可选配置全站访问口令；解锁后的访问者共享全部内容，适合访问者均可信的环境。

公网部署请开启[访问口令](doc/configuration.zh-CN.md#访问口令)并使用 HTTPS；网络连通条件见[局域网与公网访问](doc/configuration.zh-CN.md#局域网与公网访问)。

## 快速开始

先获取源码并进入项目目录，再选择下面一种方式启动：

```sh
git clone https://github.com/MARETU01/gothrough.git
cd gothrough
```

### Docker Compose

安装并启动 Docker 后执行：

```sh
docker compose up -d --build
```

访问 `http://localhost:9815`。数据保存在 Docker 卷中，`docker compose down` 停止服务并保留数据；`docker compose down -v` 会删除数据卷。

镜像拉取、端口修改、证书和卷权限见 [Docker 部署](doc/docker.zh-CN.md)。

### 从源码构建

准备 Go、Node.js / npm 和 GNU Make，版本要求及 Windows 环境见[构建说明](doc/build.zh-CN.md#环境要求)。

```sh
make build

# Linux / macOS
./release/gothrough

# Windows / Git Bash
./release/gothrough.exe
```

访问 `http://localhost:9815`。前端已包含在程序中，部署机器无需 Node.js。运行配置位于 `release/config/config.yaml`，监听地址、TLS 和数据目录见[配置说明](doc/configuration.zh-CN.md)。

### 其他设备访问

支持通过局域网或公网访问同一个服务：

- **局域网**：设备连接同一局域网后，访问 `http://<服务器的局域网IP>:9815`，例如 `http://192.168.1.100:9815`，将示例 IP 替换为实际地址，并放通服务器防火墙端口。
- **公网**：部署到有公网入口的服务器，通过公网地址或绑定的域名访问，例如 `https://files.example.com`（需自行配置域名与 HTTPS）。云服务器需配置安全组和防火墙；家庭网络需配置路由器端口转发，无可用公网入口时可使用内网穿透。

默认监听 `0.0.0.0:9815`，表示接受所有 IPv4 网卡上的连接；公网可达性取决于网络及端口配置。`localhost` 仅用于服务所在电脑本机访问。详细说明见[局域网与公网访问](doc/configuration.zh-CN.md#局域网与公网访问)。

## 共享剪贴板

打开「剪贴板」，输入文本、粘贴截图或选择 PNG/JPEG 后点击「发布」，其他设备访问同一服务即可查看。应用不会自动读取或发布系统剪贴板。

文本和图片合计保留最近 100 条。单条文本最多 64 KiB；图片默认最多 10 MiB、2000 万像素，总容量为 200 MiB，统一保存为 PNG。图片限额及备份规则见[配置说明](doc/configuration.zh-CN.md#图片剪贴板)。

一键复制需要 HTTPS / localhost 和浏览器剪贴板权限；不可用时可手动复制文本或打开、下载图片。

## 使用限制

- 可配置全站访问口令，但不提供独立用户和文件归属隔离；解锁后均可查看、上传和删除共享内容。配置方法见[访问口令](doc/configuration.zh-CN.md#访问口令)。
- 不支持浏览器刷新或服务重启后的断点续传；服务启动会清理临时上传。
- 临时上传与已上传文件必须位于同一个支持硬链接的文件系统；Docker 需将整个 `/data` 挂载为同一个卷。
- 空文件夹不会保存；支持在文件列表中将文件夹及其子目录下载为 ZIP。同路径文件冲突时自动改名，不覆盖已有文件。

## 文档

| 文档 | 内容 |
| --- | --- |
| [配置说明](doc/configuration.zh-CN.md) | 配置文件、环境变量、数据目录与备份 |
| [Docker 部署](doc/docker.zh-CN.md) | 镜像构建与发布、Compose、持久化及 HTTPS |
| [日志说明](doc/logging.zh-CN.md) | 日志配置、请求关联与排错 |
| [构建与检查](doc/build.zh-CN.md) | 开发环境、构建命令、测试及 CI |
| [目录与分层](doc/architecture.zh-CN.md) | 目录职责、依赖方向和状态归属 |
| [前端开发](frontend/README.zh-CN.md) | 本地开发、代码入口及国际化 |
| [传输与接口](doc/transfer.zh-CN.md) | 上传与剪贴板接口、协议及资源限制 |

## 许可证

[MIT](LICENSE)
