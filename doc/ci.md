# 持续集成

[返回项目首页](../README.md)

工作流位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。推送到 `main`、推送 `v*` 标签、创建或更新 Pull Request 时自动运行，也可以在 GitHub 的 Actions 页面手动触发 `CI`。

## 检查范围

| 任务 | 环境 | 检查 |
| --- | --- | --- |
| Backend | Ubuntu、Windows | 普通 Go 测试、vet、无嵌入资源构建 |
| Frontend and embedded build | Ubuntu | 前端 lint、测试、构建，Go 嵌入版构建、测试、vet，以及 race 检测 |
| Verify Docker image | Ubuntu | PR、版本标签和手动运行时，构建 amd64 镜像并验证上传及重启持久化，不登录 GHCR |
| Publish versioned Docker image | Ubuntu | 仅版本标签推送且所有检查通过后，发布多架构镜像 |

普通后端任务设置 `CGO_ENABLED=0`，验证不依赖前端产物的开发构建。嵌入任务设置 `CGO_ENABLED=1`，使用 Ubuntu runner 的 C 工具链运行 `go test -race -tags embedweb ./...`，覆盖普通与嵌入相关的 Go 包。

Go 版本从 `go.mod` 读取，Node.js 使用 24。Go 和 npm 下载缓存用于减少重复下载，前端仍按照 lockfile 安装依赖。安装标记沿用 Makefile，同一个任务中的后续构建不会再次安装。

普通检查使用仓库只读权限；镜像发布任务额外授予 `packages: write`，使用 GitHub 自动提供的 `GITHUB_TOKEN` 登录 GHCR，不需要额外 Docker Hub secrets。相同分支的新运行会取消旧运行，避免重复占用资源。工作流不自动提交代码、部署服务器或创建 Release。

## 触发与发布规则

| 事件 | 常规 CI | 容器构建与验证 | 发布镜像 |
| --- | --- | --- | --- |
| push 到 main | 是 | 否 | 否 |
| 创建或更新 PR | 是 | 是，amd64 | 否 |
| 推送版本标签 | 是 | 是，amd64 | 所有检查通过后发布 amd64/arm64 |
| Actions 手动运行 | 是 | 是，amd64 | 否 |

镜像验证任务只有读取仓库的权限，不登录镜像仓库；只有版本发布任务具有包写入权限。发布任务要求标签指向 `origin/main` 历史中的提交，避免为未合并的分支发布镜像。

发布前会加载本地 amd64 镜像并启动容器，验证页面可访问、真实分块上传、下载内容一致和重启后文件仍存在。该检查也覆盖 `/data` 卷权限和跨目录硬链接。通过后构建 `linux/amd64`、`linux/arm64` 镜像；arm64 使用 QEMU 完成运行镜像的构建，但不额外执行 arm64 容器功能测试。

镜像名由仓库名自动转换为小写，本仓库对应：

```text
ghcr.io/maretu01/gothrough:latest
ghcr.io/maretu01/gothrough:v1.0.0
ghcr.io/maretu01/gothrough:sha-<完整提交SHA>
```

`latest` 仅在正式版本标签成功发布时更新；`v1.1.0-beta.1`、`v2.0.0-rc.1` 等预发布标签只生成对应版本和 SHA 标签，不更新 latest。普通 main push 和手动运行均不再发布镜像。现有 latest 会保留，直到下一次正式版本发布覆盖它。

支持 `v主版本.次版本.修订版本`，以及可选的 `-预发布标识`；不接受数字前导零、`+build` 元数据或超过 Docker 标签长度的版本名。标签规则脚本位于 [image-tags.sh](../.github/scripts/image-tags.sh)，Linux 后端任务会执行其测试。

Docker 构建缓存存储在 GitHub Actions 中，检查失败、容器验证失败、标签无效或权限不足时不会完成发布。当前不自动创建 GitHub Release，也不自动部署服务器。

## 发布一个版本

先将改动合并到 main，确认工作区干净、main 已同步且对应 CI 通过，再执行：

```sh
git switch main
git pull --ff-only origin main
git status
git log -1 --oneline
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

这会发布版本与 SHA 镜像，并更新 latest。发布预览版可改用 `v1.1.0-beta.1`，不会修改 latest。已发布标签保持不动，修复后使用新的版本号。工作流不会比较版本号大小，例如先发布 v2.0.0、再发布 v1.0.1，latest 会指向后发布的 v1.0.1。

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
