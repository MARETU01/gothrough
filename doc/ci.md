# 持续集成

[返回项目首页](../README.md)

工作流位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。推送到 `main`、创建或更新 Pull Request 时自动运行，也可以在 GitHub 的 Actions 页面手动触发 `CI`。

## 检查范围

| 任务 | 环境 | 检查 |
| --- | --- | --- |
| Backend | Ubuntu、Windows | 普通 Go 测试、vet、无嵌入资源构建 |
| Frontend and embedded build | Ubuntu | 前端 lint、测试、构建，Go 嵌入版构建、测试、vet，以及 race 检测 |
| Publish Docker image | Ubuntu | 前置检查通过后，验证容器上传和持久化，再构建并发布多架构镜像 |

普通后端任务设置 `CGO_ENABLED=0`，验证不依赖前端产物的开发构建。嵌入任务设置 `CGO_ENABLED=1`，使用 Ubuntu runner 的 C 工具链运行 `go test -race -tags embedweb ./...`，覆盖普通与嵌入相关的 Go 包。

Go 版本从 `go.mod` 读取，Node.js 使用 24。Go 和 npm 下载缓存用于减少重复下载，前端仍按照 lockfile 安装依赖。安装标记沿用 Makefile，同一个任务中的后续构建不会再次安装。

普通检查使用仓库只读权限；镜像发布任务额外授予 `packages: write`，使用 GitHub 自动提供的 `GITHUB_TOKEN` 登录 GHCR，不需要额外 Docker Hub secrets。相同分支的新运行会取消旧运行，避免重复占用资源。工作流不自动提交代码、部署服务器或创建 Release。

## 自动发布镜像

推送到 `main`，或在 Actions 页面选择 `main` 手动运行后，只有前面的两个后端平台检查和前端/嵌入版检查全部通过，才执行镜像发布。PR 和其他分支的手动运行不会发布。

发布前会加载本地 amd64 镜像并启动容器，验证页面可访问、真实分块上传、下载内容一致和重启后文件仍存在。该检查也覆盖 `/data` 卷权限和跨目录硬链接。通过后构建 `linux/amd64`、`linux/arm64` 镜像；arm64 使用 QEMU 完成运行镜像的构建，但不额外执行 arm64 容器功能测试。

镜像名由仓库名自动转换为小写，本仓库对应：

```text
ghcr.io/maretu01/gothrough:latest
ghcr.io/maretu01/gothrough:sha-<完整提交SHA>
```

`latest` 跟随成功发布的 main 提交，SHA 标签用于定位指定版本。Docker 构建缓存存储在 GitHub Actions 中。工作流文件本身不会立即生成镜像，需要提交并推送，或推送后手动触发；检查失败、镜像构建失败或权限不足时不会完成发布。

拉取与运行、GHCR 可见性及权限排查见 [Docker 部署](docker.md)。

## 本地复现

项目根目录执行，Windows 使用 Git Bash：

```sh
make test
make install
npm --prefix frontend run lint
npm --prefix frontend test
make -j2 build test-embedded
```

具备 CGO 和 C 编译器时补充：

```sh
CGO_ENABLED=1 go test -race -tags embedweb ./...
```

Windows 本机缺少 C 工具链时可先完成其他检查，再查看 GitHub Actions 中 Linux race 检测的结果。工作流提交并推送到 GitHub 后才会实际触发，添加文件本身不代表远程检查已通过。

## 官方参考

- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-go](https://github.com/actions/setup-go)
- [actions/setup-node](https://github.com/actions/setup-node)
