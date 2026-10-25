# 前端嵌入与发布打包

[返回项目首页](../README.md)

本页命令均在项目根目录执行；监听端口和 TLS 设置见[配置说明](configuration.md)。

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
