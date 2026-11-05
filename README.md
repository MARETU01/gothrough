# GoThrough

基于 Go + Gin 和 React + TypeScript 的文件上传工具，支持将前端嵌入 Go 可执行文件部署。

## 功能

- 大文件分块并发上传，支持文件和文件夹拖拽、多文件队列、暂停、恢复、取消和失败重试。
- 拖入文件夹时保留顶层目录和子目录结构；文件列表按相对路径展示，支持逐文件下载和删除。
- 展示上传速度、进度、预计剩余时间及不含暂停时间的耗时。
- 站内切换页面时继续上传，存在未完成任务时提供浏览器离开提醒。
- 文件列表支持搜索、排序、分页、下载、二次确认删除和磁盘空间展示。
- 支持 HTTP / HTTPS，监听地址、端口和证书路径可通过 YAML 配置及环境变量设置。
- 支持前后端分离开发，也可打包为包含前端资源的单个可执行文件。

## 环境要求

- Go：版本要求见 [go.mod](go.mod)。
- Node.js 26 LTS（26.13.0 或更高的 26.x 版本）/ npm：用于前端开发和发布构建，部署机器无需安装。仓库根目录的 `.nvmrc` 指定本地默认版本 26.13.0，可执行 `nvm use 26` 切换到已安装的 26.x 版本。
- GNU Make 和 POSIX shell：执行 Makefile；Windows 使用 Git Bash。

以下命令均在项目根目录执行。Windows 若提供的命令名为 `mingw32-make`，将示例中的 `make` 替换为该命令。

## 快速开始

### 本地开发

启动后端：

```sh
go run ./cmd
```

另开终端启动前端：

```sh
make install
npm --prefix frontend run dev
```

打开 Vite 输出的开发地址。后端默认监听 `http://localhost:8080`，前端开发服务器将 `/api` 代理到后端。

### 打包运行

```sh
make build
```

启动生成的程序：

```sh
# Windows / Git Bash
./release/gothrough.exe

# Linux / macOS
./release/gothrough
```

默认访问 `http://localhost:8080`。前端已嵌入程序，部署时无需携带前端源码、`dist` 或 `node_modules`。

运行配置保存在外部 `config/config.yaml`。打包会将默认配置复制到 `release/config/config.yaml`，已有文件不会被覆盖。修改监听地址、端口、TLS 或环境变量，参见[配置说明](doc/configuration.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `make` / `make build` | 按需安装依赖，构建并嵌入前端，输出可执行文件 |
| `make install` | 下载 Go 模块并按需安装前端依赖 |
| `make test` | 构建嵌入资源，执行普通及嵌入版后端测试和 vet |
| `make help` | 查看构建命令 |

构建缓存、自定义输出路径和跨平台编译详见[构建与部署](doc/build.md)。

## 项目结构

```text
cmd/                    Go 启动入口
config/                 外部配置文件
doc/                    项目文档
frontend/               React 前端
internal/config/        配置加载与校验
internal/handler/       HTTP 接口处理
internal/model/         数据模型
internal/router/        API 和前端资源路由
internal/service/       上传会话与文件服务
internal/utils/         文件名、路径和磁盘工具
internal/webassets/     前端资源嵌入包
Makefile                开发检查和发布构建入口
```

`release/`、前端构建产物、嵌入资源副本及运行时上传数据不纳入 Git。开发时从根目录运行；发布版的上传目录位于可执行文件旁。

## 文档

| 文档 | 内容 |
| --- | --- |
| [配置说明](doc/configuration.md) | YAML 配置、环境变量、配置优先级、证书路径和开发代理 |
| [构建与部署](doc/build.md) | Makefile、依赖缓存、前端嵌入、发布及跨平台构建 |
| [传输实现](doc/transfer.md) | 分块协议、并发控制、临时文件、校验及资源限制 |
| [持续集成](doc/ci.md) | GitHub Actions 检查范围、race 检测及本地复现 |
| [Docker 部署](doc/docker.md) | 镜像构建、Compose、数据持久化及 HTTPS |
| [前端说明](frontend/README.md) | 前端开发、代码组织及测试 |

## 使用限制

- 临时目录与上传目录必须位于同一个支持硬链接的文件系统。
- 当前不支持浏览器刷新或服务重启后的断点续传；服务启动会清理临时上传。
- 文件夹拖拽会上传其中的文件，空文件夹不会保存；同路径文件冲突时自动改名，不会覆盖已有文件。
- 目前未提供用户鉴权和文件归属隔离，也不支持文件夹打包下载。

## 许可证

[MIT](LICENSE)
