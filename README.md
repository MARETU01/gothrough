# GoThrough

Go + Gin 文件上传服务，配套 React + TypeScript 前端。

## 本地启动

在仓库根目录启动后端：

```sh
go run ./cmd
```

后端默认监听 `http://localhost:8080`。另开终端启动前端：

```sh
cd frontend
npm ci
npm run dev
```

前端通过 Vite 将 `/api` 请求代理到后端。

## 目录

- `cmd/main.go`：后端启动入口。
- `internal/`：配置、路由、处理器、上传服务与模型。
- `internal/utils/disk*.go`：基于标准库的统一磁盘容量查询，支持 Windows、Linux、macOS 和 FreeBSD；其他系统返回不支持错误。
- `frontend/`：React 前端，详见 `frontend/README.md`。
- `uploads/`、`temp_uploads/`：运行时数据，不纳入 Git。

开发模式下，页面由 Vite 提供，Go 提供接口；发布模式可以将前端构建产物嵌入 Go 可执行文件，不依赖 HTML 模板。`/api/files` 返回 JSON 文件列表，下载与删除接口继续保留。

开发时从根目录运行；部署编译后的程序时，运行时上传目录位于可执行文件旁。当前服务启动会清理临时分块。

## 传输实现

上传使用 8MiB 分块，前端每个文件 3 路并发、同时处理 2 个文件。初始化返回 `upload_transport: "raw"`，新版前端将 Blob 作为 `application/octet-stream` 请求体直接发送；未声明该能力的旧服务端仍使用 multipart。旧 multipart 客户端也可以继续请求新版后端，需采用初始化返回的分块大小。

后端通过 `io.CopyBuffer` 和偏移写入，把每块直接写入同一个临时文件，复用 256KiB 缓冲，不将整块读入内存，也不再读出全部分块合并。完成前校验分块数量和文件大小、执行 Sync，再用不覆盖现有文件的硬链接发布。临时目录与上传目录必须位于同一个支持硬链接的文件系统，例如同一 NTFS/ext4 分区；不支持的文件系统会明确返回发布错误，保留会话供重试或取消。下载继续使用标准库文件服务，支持 Range 请求。

会话独立控制并发，重复块不会覆盖已确认数据；最多同时接收 16 个块、保留 1024 个活跃会话，超限返回 429。单文件上限 1TiB。每 5 分钟清理闲置超过 24 小时的会话，正在写入的会话不会被清理。会话保存在内存，服务重启仍会清空临时上传，不提供重启后的续传。

默认关闭逐请求访问日志，设置 `GOTHROUGH_ACCESS_LOG=1` 可开启。服务器设置请求头、请求体和空闲连接超时；退出时最多等待 30 秒让已有请求结束，再关闭连接并清理临时会话。

## 前端嵌入与发布打包

安装 Go、Node.js/npm 和 GNU Make 后，在仓库根目录执行（Windows 使用 Git Bash；默认目标也是 `build`）：

```sh
make build
```

Makefile 依次执行 `npm ci`、前端构建和带 `embedweb` 标签的 Go 构建，任何一步失败会停止；`make -j` 也保持这些步骤的先后顺序。Windows 自动输出 `release/gothrough.exe`，Linux/macOS 输出 `release/gothrough`。Windows 若命令名为 `mingw32-make`，将命令中的 `make` 替换为 `mingw32-make`。

Windows 在 Git Bash 中启动：

```sh
./release/gothrough.exe
```

Linux/macOS 启动：

```sh
./release/gothrough
```

可用目标和参数：

| 命令 | 用途 |
| --- | --- |
| `make` / `make build` | 安装前端依赖、构建前端并打包 Go |
| `make frontend` | 安装前端依赖并构建 `frontend/dist` |
| `make install` | 按 lockfile 安装前端依赖 |
| `make test` | 后端常规测试及 vet，不要求前端构建产物 |
| `make test-embedded` | 构建前端，再运行嵌入版测试及 vet |
| `make OUTPUT=release/custom.exe` | 自定义输出文件路径 |
| `make OUT_DIR=out` | 修改默认输出目录 |
| `make help` | 查看命令说明 |

Makefile 统一使用 `sh` 和 POSIX 命令，不调用 cmd 或 PowerShell。可通过 `GO`、`NPM` 指定工具命令。跨平台打包通过标准 `GOOS`、`GOARCH` 环境变量指定目标，输出扩展名根据 Go 目标平台自动选择。例如在 Git Bash 中执行 `GOOS=linux GOARCH=amd64 make build`，这些设置仅影响本次命令。

手动构建：

```sh
cd frontend
npm ci
npm run build
cd ..
go build -tags embedweb -trimpath -ldflags="-s -w" -o release/gothrough.exe ./cmd
```

发布后访问 `http://localhost:8080`（或实际后端监听地址）。前端 HTML、JS、CSS 已包含在程序中，部署机器不需要 Node.js，也不需要携带 `frontend/dist`。现有运行配置、TLS 证书和上传数据仍由后端按原方式读取，不会嵌入可执行文件。运行目录需有创建上传数据目录的权限。

根目录的 `embed.go` 通过 `go:embed all:frontend/dist` 嵌入文件，对外提供去掉 `frontend/dist` 前缀的资源文件系统。带标签构建前必须生成 `frontend/dist`，缺少构建产物会编译失败；修改前端后必须重新构建前端和 Go。`dist` 与 `release` 均不纳入 Git，因此 CI 也需要先执行前端构建。

Gin 保留所有接口，未命中接口的 GET/HEAD 请求由嵌入资源处理。`/`、`/upload`、`/files` 返回 SPA 入口，直接访问和刷新正常；不存在的 API、静态资源和其他路径返回 404。以后增加前端页面路由时，需同步更新 `internal/router/web.go` 的页面回退列表。带哈希的 Vite 资源长期缓存，HTML 与公共资源使用 `no-cache`。

普通 `go run ./cmd`、`go test ./...`、`go build ./...` 不嵌入页面，也不要求生成 `dist`，继续配合 Vite 开发代理使用。前端 API 保持同源 `/api`，无需额外跨域配置。

### 嵌入版检查

前端构建完成后执行：

```sh
go test -tags embedweb ./...
go vet -tags embedweb ./...
```

## 常规检查

```sh
go test ./...
go build ./...
```
