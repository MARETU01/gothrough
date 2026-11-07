# 构建与检查

[English](build.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

以下命令在项目根目录执行，Windows 使用 Git Bash；若 Make 命令名为 `mingw32-make`，请替换示例中的 `make`。

## 环境要求

- Go：版本要求见 [go.mod](../go.mod)。
- Node.js 26.13.0 或更高的 26.x 版本及 npm；仓库根目录的 `.nvmrc` 指定默认版本，可执行 `nvm use 26` 选择已安装的 26.x。
- GNU Make 和 POSIX shell；Windows 使用 Git Bash。

这些工具用于开发和构建，部署机器无需安装。前后端分开启动及 Vite 代理配置见[前端开发](../frontend/README.zh-CN.md#本地开发与检查)。

## 构建与运行

```sh
make build

# Windows / Git Bash
./release/gothrough.exe

# Linux / macOS
./release/gothrough
```

默认访问 `http://localhost:9815`。构建按需安装依赖、生成前端资源，再以 `embedweb` 标签编译 Go。部署只需可执行文件、外部配置及所需证书，目标机器无需 Node.js。程序还需有数据目录的读写权限；端口、TLS 和数据目录规则见[配置说明](configuration.zh-CN.md)。

默认配置复制到输出目录的 `config/config.yaml`，已有文件不会被覆盖。配置、证书和运行数据均不嵌入程序。

前端构建还会为不小于 1 KiB 且压缩后更小的 JS/CSS 文件生成 gzip 副本。嵌入版服务自动根据浏览器支持情况返回 gzip，其他客户端仍可获取原文件。压缩在构建时完成，无需运行时配置或额外依赖，以可执行文件略微增大换取网络传输量减少。上传和下载 API 不受影响。

| 命令 | 用途 |
| --- | --- |
| `make` / `make build` | 构建包含前端的可执行文件 |
| `make install` | 下载 Go 模块并按需安装前端依赖 |
| `make test` | 构建前端、运行前端 lint 和测试，以及普通和嵌入版 Go 测试与 vet |
| `make test-race` | 构建前端并运行嵌入版 Go race 检测；需要 C 编译器 |
| `make clean` | 删除当前 `OUTPUT`、`frontend/dist/` 和 `internal/webassets/dist/`，保留配置、数据和依赖 |
| `make OUTPUT=release/custom.exe` | 自定义输出文件路径 |
| `make OUT_DIR=out` | 修改默认输出目录 |
| `make help` | 查看命令说明 |

`make clean` 应单独运行，不要与构建或测试并行执行。清理自定义输出时，传入构建时使用的相同 `OUTPUT` 或 `OUT_DIR`。

通过 `GO`、`NPM` 可指定工具命令。交叉编译使用标准 Go 环境变量，输出扩展名随目标平台选择：

```sh
GOOS=linux GOARCH=amd64 make build
```

## 依赖与嵌入资源

构建会自动安装所需依赖。切换 Node.js/npm 版本或依赖异常时，执行 `make -B install` 强制重装；不要与其他构建任务同时运行。

普通 `go run ./cmd`、`go test ./...`、`go build ./...` 不需要前端产物。手动执行带 `-tags embedweb` 的 Go 命令前，先运行 `make build` 生成资源；修改前端后需重新构建。

新增前端页面时，同步更新 `internal/router/web.go` 的 SPA 回退路由。

## 检查与持续集成

本地执行：

```sh
make install
make -j2 build test
```

`make test` 已包含前端 lint 和测试、普通及嵌入版 Go 测试和 vet，无需重复运行。具备 CGO 和 C 编译器时补充 race 检测：

```sh
make test-race
```

工作流位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)，在 main push、`v*` 标签、PR 和 Actions 手动运行时触发。同一分支的新运行会取消旧运行。

| 任务 | 环境 | 检查 |
| --- | --- | --- |
| Backend | Ubuntu、Windows，CGO 关闭 | 普通 Go 测试、vet、无嵌入资源构建；Linux 另测镜像标签规则 |
| Frontend and embedded build | Ubuntu，CGO 开启 | 前端 lint、测试、构建，Go 嵌入版构建、测试、vet 和 race 检测 |
| Verify Docker image | Ubuntu，仅 PR、标签和手动运行 | amd64 容器页面、分块上传、下载一致性及重启持久化 |
| Publish versioned Docker image | Ubuntu，仅版本标签且检查通过 | 发布 amd64/arm64 镜像 |

Go 版本从 `go.mod` 读取，Node.js 使用 26.x，依赖按 lockfile 安装。Windows 无 C 工具链时，可在本地完成其他检查并查看 CI 的 Linux race 结果。镜像凭据、标签规则和发布步骤集中在 [Docker 部署](docker.zh-CN.md#github-自动构建与发布)。

## GitHub Release

[`.github/workflows/release.yml`](../.github/workflows/release.yml) 在推送 `v*` 标签时运行。版本须符合 Docker 发布的格式，例如 `v0.0.4` 或 `v0.0.4-beta.1`，且标签对应的提交已包含在 `main` 历史中。先合并并推送工作流，再打标签；标签对应的提交必须包含该工作流。

工作流先校验版本、检查前端 lint 和测试，执行普通及嵌入版 Go 测试与 vet，并构建一次前端。随后六个 Linux 任务并行通过 `CGO_ENABLED=0`、`embedweb` 标签交叉编译：

| 目标平台 | 压缩包 |
| --- | --- |
| Windows amd64 / arm64 | `gothrough-<version>-windows-<arch>.zip` |
| Linux amd64 / arm64 | `gothrough-<version>-linux-<arch>.tar.gz` |
| macOS amd64 / arm64 | `gothrough-<version>-darwin-<arch>.tar.gz` |

每个压缩包内有一个目录，包含可执行文件和受版本控制的 `config/config.yaml` 模板，不包含本地运行配置。交叉编译验证各平台代码可以编译；该工作流在 Linux 上运行测试，不会逐一在目标系统执行测试。

Actions 产物直接上传上述压缩包，名称包含项目名、版本、系统和架构，不再套一层 ZIP；Linux/macOS 下载为 `.tar.gz`，Windows 下载为 `.zip`。前端共享资源是独立的内部产物，不会附加到 Release。

全部构建成功后，工作流创建 GitHub Release **草稿**，自动生成更新说明，并上传六个压缩包和 `SHA256SUMS`。预发布标签会自动将草稿标记为预发布。仅最后的上传任务拥有 `contents: write` 权限，使用内置 `GITHUB_TOKEN`，无需另配 Release 密钥；仓库或组织策略须允许该权限。

例如，同步 `main` 并确认 CI 通过后，推送一个尚未使用的标签：

```sh
git tag -a v0.0.4 -m "Release v0.0.4"
git push origin v0.0.4
```

在 Actions 中检查 Release 工作流，再到 Releases 检查草稿说明和下载包，点击 **Publish release** 正式发布。重新运行工作流会替换已有草稿的附件，但会拒绝覆盖已发布的 Release。在包含所有下载包的目录中，可运行 `sha256sum --check SHA256SUMS` 验证文件。

此工作流与 CI 中的 Docker 发布独立运行。Docker 镜像仍在标签推送、其自身检查通过后发布，即使 GitHub Release 仍是草稿；Release 草稿生成成功也不代表 Docker 发布成功。
