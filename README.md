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

## 端口与 TLS 配置

外部配置文件 `config/config.yaml`：

```yaml
server:
  host: "0.0.0.0"
  port: 8080
  tls:
    enabled: false
    cert_file: "certs/server.crt"
    key_file: "certs/server.key"
```

相对证书路径以配置文件所在目录为基准，示例对应 `config/certs/server.crt` 与 `config/certs/server.key`。证书、私钥不嵌入程序，`config/certs/` 不纳入 Git。启用 TLS 后端口不会自动改为 443；需将 `server.port` 设置为期望端口（例如 8443）。服务只启动一个 HTTP 或 HTTPS 监听器。

配置文件选择顺序：`-config 指定路径` → `GOTHROUGH_CONFIG` → 可执行文件旁的 `config/config.yaml` → 工作目录下的 `config/config.yaml`。没有默认配置文件时使用内置 HTTP `0.0.0.0:8080`，也支持纯环境变量启动；显式指定的文件缺失或格式错误则启动失败。未知 YAML 字段会报错，避免拼写错误被忽略。

字段优先级：**环境变量 > 显式 `-tls` 参数 > YAML 配置 > 内置默认值**。不指定 `-tls` 不会覆盖文件中的 TLS 设置；`-tls=true/false` 只影响开关，不提供证书路径。环境变量中的空字符串也视为明确覆盖，空端口或无效布尔值会报错。

| 环境变量 | 用途 |
| --- | --- |
| `GOTHROUGH_CONFIG` | 指定配置文件路径，低于 `-config` |
| `GOTHROUGH_HOST` | 监听 IP 或主机名，不含协议和端口；IPv6 不加方括号 |
| `GOTHROUGH_PORT` | 监听端口，范围 1～65535 |
| `GOTHROUGH_TLS_ENABLED` | TLS 开关，建议填写 `true` / `false` |
| `GOTHROUGH_TLS_CERT_FILE` | PEM 证书链文件路径 |
| `GOTHROUGH_TLS_KEY_FILE` | PEM 私钥文件路径 |

文件和环境变量提供的相对证书路径使用同一规则；未加载配置文件时相对于工作目录解析。环境变量指进程环境，后端不会自动读取 `.env`。

Git Bash 使用示例：

```sh
# 用环境变量覆盖端口，保留配置文件其他设置
GOTHROUGH_PORT=9000 go run ./cmd

# 指定其他配置文件
./release/gothrough.exe -config ./config/config.yaml

# 覆盖为 HTTPS，使用绝对路径明确定位证书
GOTHROUGH_PORT=8443 GOTHROUGH_TLS_ENABLED=true \
GOTHROUGH_TLS_CERT_FILE="C:/certs/server.crt" \
GOTHROUGH_TLS_KEY_FILE="C:/certs/server.key" ./release/gothrough.exe
```

启动前校验端口、监听地址和启用 TLS 时的证书/私钥是否可加载；校验失败不会初始化或清理上传目录。修改配置或环境变量后需要重启进程，不提供热更新。

Vite 开发代理独立于后端配置。如果后端改到 9000 端口，可启动：

```sh
GOTHROUGH_DEV_API_TARGET=http://127.0.0.1:9000 npm --prefix frontend run dev
```

该变量也可写入 `frontend/.env.local`（需重启 Vite）。嵌入版前端使用同源 `/api`，不需要额外配置代理；证书和后端环境变量不会发送到浏览器。

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

Makefile 在首次构建、依赖清单或 npm 配置变更、删除 `node_modules` 后执行 `npm ci`，其他时候复用已安装依赖，再执行前端构建和带 `embedweb` 标签的 Go 构建。任何一步失败会停止；`make -j` 也保持这些步骤的先后顺序。Windows 自动输出 `release/gothrough.exe`，Linux/macOS 输出 `release/gothrough`。Windows 若命令名为 `mingw32-make`，将命令中的 `make` 替换为 `mingw32-make`。

打包同时将默认配置复制到输出目录的 `config/config.yaml`；如果该文件已存在则保留，不覆盖部署配置。配置文件、证书和私钥均保持外置。

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
| `make` / `make build` | 按需安装依赖、构建前端并打包 Go |
| `make frontend` | 按需安装依赖并构建 `frontend/dist` |
| `make web-assets` | 构建前端并同步产物到 `internal/webassets/dist` |
| `make install` | 仅在依赖清单或 npm 配置变更时安装依赖 |
| `make reinstall` | 按 lockfile 强制重新安装依赖 |
| `make test` | 后端常规测试及 vet，不要求前端构建产物 |
| `make test-embedded` | 构建前端，再运行嵌入版测试及 vet |
| `make OUTPUT=release/custom.exe` | 自定义输出文件路径 |
| `make OUT_DIR=out` | 修改默认输出目录 |
| `make help` | 查看命令说明 |

Makefile 统一使用 `sh` 和 POSIX 命令，不调用 cmd 或 PowerShell。可通过 `GO`、`NPM` 指定工具命令。跨平台打包通过标准 `GOOS`、`GOARCH` 环境变量指定目标，输出扩展名根据 Go 目标平台自动选择。例如在 Git Bash 中执行 `GOOS=linux GOARCH=amd64 make build`，这些设置仅影响本次命令。

依赖安装标记保存在 `frontend/node_modules/.gothrough-deps-installed`，不纳入 Git。`package.json`、`package-lock.json` 和已有 `.npmrc` 的时间戳用于判断是否需要重装；首次切换到这版 Makefile 会先安装一次。更换 Node.js/npm 版本、修改 npm 环境参数或怀疑依赖损坏时执行 `make reinstall`。不要同时运行 `make reinstall` 和其他构建任务，因为它会删除并重新创建 `node_modules`。

前端源码和资源仍会正常重新构建、完整同步，避免删除文件后残留旧产物；TypeScript 与 Go 继续复用各自的编译缓存。主要提速来自跳过每次几十秒的重复依赖安装，不跳过必要的前端生成步骤。

手动构建：

```sh
make web-assets
go build -tags embedweb -trimpath -ldflags="-s -w" -o release/gothrough.exe ./cmd
```

发布后访问 `http://localhost:8080`（或实际后端监听地址）。前端 HTML、JS、CSS 已包含在程序中，部署机器不需要 Node.js，也不需要携带 `frontend/dist`。现有运行配置、TLS 证书和上传数据仍由后端按原方式读取，不会嵌入可执行文件。运行目录需有创建上传数据目录的权限。

`internal/webassets/embed.go` 通过 `go:embed all:dist` 嵌入同目录下的构建产物。Vite 仍输出到 `frontend/dist`；`make web-assets` 构建前端后，将产物完整同步到 `internal/webassets/dist`，清除该生成目录中的旧文件，避免过期哈希资源残留。`make build` 和 `make test-embedded` 会自动执行此步骤，并行执行时也会先完成同步再开始 Go 编译。

手动使用 `-tags embedweb` 前必须先执行 `make web-assets`，缺少嵌入产物会编译失败；修改前端后需重新同步和编译。两个 `dist` 目录与 `release` 均不纳入 Git，CI 也需要执行相同构建流程。

Gin 保留所有接口，未命中接口的 GET/HEAD 请求由嵌入资源处理。`/`、`/upload`、`/files` 返回 SPA 入口，直接访问和刷新正常；不存在的 API、静态资源和其他路径返回 404。以后增加前端页面路由时，需同步更新 `internal/router/web.go` 的页面回退列表。带哈希的 Vite 资源长期缓存，HTML 与公共资源使用 `no-cache`。

普通 `go run ./cmd`、`go test ./...`、`go build ./...` 不嵌入页面，也不要求生成 `dist`，继续配合 Vite 开发代理使用。前端 API 保持同源 `/api`，无需额外跨域配置。

### 嵌入版检查

前端构建并同步完成后执行（或直接运行 `make test-embedded`）：

```sh
go test -tags embedweb ./...
go vet -tags embedweb ./...
```

## 常规检查

```sh
go test ./...
go build ./...
```
