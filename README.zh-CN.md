# GoThrough

[![CI](https://img.shields.io/github/actions/workflow/status/MARETU01/gothrough/ci.yml?branch=main&logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/v/tag/MARETU01/gothrough?logo=github&style=flat-square)](https://github.com/MARETU01/gothrough/tags)
[![Go version](https://img.shields.io/github/go-mod/go-version/MARETU01/gothrough?logo=go&style=flat-square)](https://github.com/MARETU01/gothrough/blob/main/go.mod)
[![Docker Image Size](https://img.shields.io/docker/image-size/maretu01/gothrough?sort=semver&arch=amd64&logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![Docker Pulls](https://img.shields.io/docker/pulls/maretu01/gothrough?logo=docker&style=flat-square)](https://hub.docker.com/r/maretu01/gothrough)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

[English](README.md) | 简体中文

基于 Go + Gin 和 React + TypeScript 的文件上传与共享剪贴板工具，可部署为包含前端的单个可执行文件。

## 功能

- 大文件分块并发上传，支持文件与文件夹拖拽、多文件队列、暂停、恢复、取消和失败重试。
- 文件夹上传保留目录结构；文件列表支持搜索、排序、分页、下载、删除和磁盘空间查看。
- 跨设备共享文本与图片，支持粘贴截图、预览、复制及下载，历史记录在重启后保留。
- 界面支持简体中文与英文；站内切换页面时上传继续进行。
- 支持 HTTP / HTTPS、YAML 与环境变量配置，以及文本 / JSON 日志。

## 适用场景

- 在局域网中的个人设备之间传输文件和文件夹。
- 在手机与电脑之间共享文本、链接和截图。
- 在家庭服务器或可信网络中搭建临时文件共享服务。

服务采用共享访问模式，可选配置全站访问口令；解锁后的访问者共享全部内容，适合访问者均可信的环境。

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

访问 `http://localhost:8080`。数据保存在 Docker 卷中，`docker compose down` 停止服务并保留数据；`docker compose down -v` 会删除数据卷。

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

访问 `http://localhost:8080`。前端已包含在程序中，部署机器无需 Node.js。运行配置位于 `release/config/config.yaml`，监听地址、TLS 和数据目录见[配置说明](doc/configuration.zh-CN.md)。

### 其他设备访问

手机或其他电脑连接同一局域网后，访问 `http://<服务所在电脑的局域网IP>:8080`，例如 `http://192.168.1.100:8080`，请将示例 IP 替换为实际地址。服务所在电脑的防火墙需允许该端口访问。`localhost` 仅用于服务所在电脑本机访问。

## 共享剪贴板

打开「剪贴板」，输入文本、粘贴截图或选择 PNG/JPEG 后点击「发布」，其他设备访问同一服务即可查看。应用不会自动读取或发布系统剪贴板。

文本和图片合计保留最近 100 条。单条文本最多 64 KiB；图片默认最多 10 MiB、2000 万像素，总容量为 200 MiB，统一保存为 PNG。图片限额及备份规则见[配置说明](doc/configuration.zh-CN.md#图片剪贴板)。

一键复制需要 HTTPS / localhost 和浏览器剪贴板权限；不可用时可手动复制文本或打开、下载图片。

## 使用限制

- 可配置全站访问口令，但不提供独立用户和文件归属隔离；解锁后均可查看、上传和删除共享内容。配置方法见[访问口令](doc/configuration.zh-CN.md#访问口令)。
- 不支持浏览器刷新或服务重启后的断点续传；服务启动会清理临时上传。
- 临时上传与已上传文件必须位于同一个支持硬链接的文件系统；Docker 需将整个 `/data` 挂载为同一个卷。
- 空文件夹不会保存，不支持文件夹打包下载；同路径文件冲突时自动改名，不覆盖已有文件。

## 文档

| 文档 | 内容 |
| --- | --- |
| [配置说明](doc/configuration.zh-CN.md) | 配置文件、环境变量、数据目录与备份 |
| [Docker 部署](doc/docker.zh-CN.md) | 镜像构建与发布、Compose、持久化及 HTTPS |
| [日志说明](doc/logging.zh-CN.md) | 日志配置、请求关联与排错 |
| [构建与检查](doc/build.zh-CN.md) | 开发环境、构建命令、测试及 CI |
| [前端开发](frontend/README.zh-CN.md) | 本地开发、代码入口及国际化 |
| [传输与接口](doc/transfer.zh-CN.md) | 上传与剪贴板接口、协议及资源限制 |

## 许可证

[MIT](LICENSE)
