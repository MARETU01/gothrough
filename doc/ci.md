# 持续集成

[返回项目首页](../README.md)

工作流位于 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。推送到 `main`、创建或更新 Pull Request 时自动运行，也可以在 GitHub 的 Actions 页面手动触发 `CI`。

## 检查范围

| 任务 | 环境 | 检查 |
| --- | --- | --- |
| Backend | Ubuntu、Windows | 普通 Go 测试、vet、无嵌入资源构建 |
| Frontend and embedded build | Ubuntu | 前端 lint、测试、构建，Go 嵌入版构建、测试、vet，以及 race 检测 |

普通后端任务设置 `CGO_ENABLED=0`，验证不依赖前端产物的开发构建。嵌入任务设置 `CGO_ENABLED=1`，使用 Ubuntu runner 的 C 工具链运行 `go test -race -tags embedweb ./...`，覆盖普通与嵌入相关的 Go 包。

Go 版本从 `go.mod` 读取，Node.js 使用 24。Go 和 npm 下载缓存用于减少重复下载，前端仍按照 lockfile 安装依赖。安装标记沿用 Makefile，同一个任务中的后续构建不会再次安装。

工作流使用仓库只读权限，不需要配置额外 secrets；相同分支的新运行会取消旧运行，避免重复占用资源。它只执行检查和构建，不自动提交、推送、部署或创建 Release。

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
