# Docker 部署

[English](docker.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

## 构建镜像

需要安装并启动支持 Linux 容器的 Docker Engine 或 Docker Desktop，使用 BuildKit 构建。以下命令均在项目根目录执行：

```sh
docker build -t gothrough:local .
```

Dockerfile 分为前端构建、Go 编译、运行三个阶段。构建环境使用 Node.js 26 LTS 和 Go 1.27，Go 版本需与 `go.mod` 要求相容；运行镜像只保留嵌入前端的程序、默认配置和基础运行环境，不包含 Node.js、Go 工具链或源码。无需在宿主机先执行 `make`。

npm 和 Go 依赖下载、Go 编译使用 BuildKit 缓存，源码修改不会直接使依赖下载层失效。`.dockerignore` 排除本机依赖、构建产物、上传数据、环境文件和常见证书/私钥文件。

## GitHub 自动构建与发布

工作流 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 PR 中构建 amd64 镜像并验证上传下载及重启持久化，但不发布。普通 main push 只运行常规 CI。只有推送 `v1.0.0` 等版本标签，且全部 CI 和容器检查通过后，才发布镜像到 Docker Hub；标签提交必须已包含在 main 历史中。

发布支持 `linux/amd64` 和 `linux/arm64`；生成版本名（例如 `v1.0.0`）和 `sha-<完整提交SHA>` 标签。正式版本同时更新 latest；预发布版本（例如 `v1.1.0-beta.1`）不更新 latest。镜像名默认为 `<Docker Hub 用户名>/<GitHub 仓库名>` 并转换为小写，也可通过 repository variable `DOCKERHUB_REPOSITORY` 指定完整的 `命名空间/镜像名`。手动运行工作流只验证，不发布，打标签步骤见[持续集成](ci.zh-CN.md)。

首次发布前完成以下设置：

1. 在 Docker Hub 创建目标仓库，例如 `你的用户名/gothrough`；需要公开拉取时将其设为 Public。
2. 在 Docker Hub 创建具有目标仓库读写权限的访问令牌（Personal Access Token），不要使用账户密码。
3. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Secrets** 添加 `DOCKERHUB_USERNAME`（Docker Hub 登录用户名）和 `DOCKERHUB_TOKEN`（访问令牌）。不要把令牌写入代码或日志。
4. 如果 Docker Hub 命名空间或仓库名与默认值不同，在同一页面的 **Variables** 添加 `DOCKERHUB_REPOSITORY`，例如 `my-org/gothrough`；登录账号及令牌必须有该仓库的推送权限。

以下命令中的 `YOUR_USERNAME` 替换为 Docker Hub 用户名；配置了自定义仓库时替换整个镜像地址。私有仓库需要先在目标机器执行 `docker login`。

镜像首次发布成功且已具备读取权限后：

```sh
docker pull YOUR_USERNAME/gothrough:latest
docker run -d --name gothrough --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  YOUR_USERNAME/gothrough:latest
```

若登录或发布失败，检查两个 secrets 是否齐全、令牌是否有效且具有写入权限，以及镜像命名空间是否属于登录账号或已授权的组织。工作流不会自动修改仓库的可见性，也不会自动部署或更新你的服务器。认证及发布方式参见 [Docker 官方 GitHub Actions 文档](https://docs.docker.com/build/ci/github-actions/)。

## 启动容器

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

访问 `http://localhost:8080`。容器以 UID/GID `10001:10001` 运行。程序退出时可获得最多 40 秒的停止宽限期，配合应用自身的 30 秒请求等待时间。

应用日志统一输出到标准输出，可使用 `docker compose logs -f --tail=100` 查看。Compose 的 Docker 日志按每文件 `10m`、最多 `3` 个文件轮转。应用默认不额外写日志文件；JSON 格式、访问日志过滤和可选文件输出见[日志说明](logging.zh-CN.md)。

### 使用 Compose

```sh
docker compose up -d --build
docker compose logs -f
docker compose down
```

Compose 挂载项目的 `config/config.yaml` 为只读配置，并创建统一的数据卷。`docker compose down` 默认保留数据卷；`docker compose down -v` 会删除卷及其中上传文件和剪贴板历史。

默认映射宿主机 8080 到容器 8080。仅修改宿主机端口可执行：

```sh
GOTHROUGH_HTTP_PORT=9000 docker compose up -d
```

`GOTHROUGH_HTTP_PORT` 只用于 Compose 端口映射，不是后端监听端口配置。若修改配置文件中的容器监听端口，也要相应修改 `compose.yaml` 的端口映射右侧。

## 持久化目录

容器内的结构：

```text
/app/gothrough          可执行文件，不放入数据卷
/app/config/           外部配置与可挂载的证书目录
/data/uploads          已上传文件
/data/temp_uploads     临时上传会话
/data/clipboard        剪贴板历史
/data/                 单个持久化数据卷
```

镜像内置 `GOTHROUGH_DATA_DIR=/data`，直接将上传文件、临时文件和剪贴板历史放入数据卷，不再使用 `/app` 下的符号链接。数据子目录与旧版本一致，已有数据卷可继续使用。程序会创建缺失的子目录，升级镜像不会从数据卷读取旧版本可执行文件。

镜像内置环境变量优先于 YAML 中的 `storage.data_dir`。如需更换容器数据根目录，使用 `-e GOTHROUGH_DATA_DIR=/其他路径`，并同步调整挂载点。

**必须将整个 `/data` 挂载为同一个卷。** 不要把 `uploads` 和 `temp_uploads` 分别挂载为两个卷，也不要单独将临时目录放入 tmpfs；上传完成依赖跨目录硬链接。服务启动和上传初始化会检查写入及硬链接能力，不满足要求时提前报错。服务启动仍会清理临时上传，容器重启不提供上传续传。

默认推荐 Docker 管理的 named volume。使用宿主机 bind mount 时，需预先确保 UID/GID `10001:10001` 能创建和读写上述子目录；镜像不会在启动时自动修改宿主机目录权限。同一个卷不要同时供多个应用实例使用。

## 配置及环境变量

普通容器可挂载自己的配置文件：

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  --mount type=bind,source="$(pwd)/config/config.yaml",target=/app/config/config.yaml,readonly \
  gothrough:local
```

也可使用现有环境变量覆盖镜像默认配置：

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 9000:9000 \
  -e GOTHROUGH_HOST=0.0.0.0 \
  -e GOTHROUGH_PORT=9000 \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

同一容器名的示例是替代方案，不要同时执行。配置修改后需重启或重新创建容器。端口和 TLS 的完整规则见[配置说明](configuration.zh-CN.md)。

### HTTPS

证书与私钥在运行时只读挂载，不加入镜像。示例使用容器内 8443 端口：

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8443:8443 \
  -e GOTHROUGH_HOST=0.0.0.0 \
  -e GOTHROUGH_PORT=8443 \
  -e GOTHROUGH_TLS_ENABLED=true \
  -e GOTHROUGH_TLS_CERT_FILE=/app/config/certs/server.crt \
  -e GOTHROUGH_TLS_KEY_FILE=/app/config/certs/server.key \
  --mount type=bind,source="$(pwd)/config/certs",target=/app/config/certs,readonly \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

挂载的证书和私钥需允许容器 UID 10001 读取。监听地址使用 `0.0.0.0`，不要配置为容器内 `127.0.0.1`，否则宿主机端口映射无法访问。

Windows Git Bash 可能自动转换命令中的 `/app`、`/data` 路径。如果路径被改写，可先设置 `export MSYS_NO_PATHCONV=1`，并为 bind mount 的 `source` 使用 `pwd -W` 或 `C:/...` 格式的真实 Windows 路径。Compose 命令不需要手工传递这些容器路径，Windows 优先使用 Compose。

## 多架构构建

Dockerfile 支持 Buildx 的目标平台参数，例如：

```sh
docker buildx build --platform linux/arm64 -t gothrough:arm64 --load .
```

构建阶段运行于构建机平台，Go 使用目标平台交叉编译；本地加载的镜像仍需对应平台的宿主机或模拟环境才能运行。

## 官方参考

- [Docker 多阶段构建](https://docs.docker.com/build/building/multi-stage/)
- [Docker 数据卷](https://docs.docker.com/engine/storage/volumes/)
- [Docker 构建缓存](https://docs.docker.com/build/cache/optimize/)
