# Docker 部署

[返回项目首页](../README.md)

## 构建镜像

需要安装并启动支持 Linux 容器的 Docker Engine 或 Docker Desktop，使用 BuildKit 构建。以下命令均在项目根目录执行：

```sh
docker build -t gothrough:local .
```

Dockerfile 分为前端构建、Go 编译、运行三个阶段。构建环境使用 Node.js 24 和 Go 1.27，Go 版本需与 `go.mod` 要求相容；运行镜像只保留嵌入前端的程序、默认配置和基础运行环境，不包含 Node.js、Go 工具链或源码。无需在宿主机先执行 `make`。

npm 和 Go 依赖下载、Go 编译使用 BuildKit 缓存，源码修改不会直接使依赖下载层失效。`.dockerignore` 排除本机依赖、构建产物、上传数据、环境文件和常见证书/私钥文件。

## GitHub 自动构建与发布

工作流 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 `main` 的 push 或 main 分支的手动运行中，等待全部 CI 检查通过后，自动验证容器上传下载及重启持久化，再发布镜像到 GitHub Container Registry（GHCR）。PR 不发布。

支持 `linux/amd64` 和 `linux/arm64`，镜像地址为 `ghcr.io/maretu01/gothrough`；同时生成 `latest` 和 `sha-<完整提交SHA>` 标签。镜像名根据仓库路径自动生成，fork 后会使用 fork 自己的仓库名。

首次成功发布后，可在 GitHub 账号或仓库关联的 Packages 页面查看镜像。GHCR 新包默认私有；如果需要未登录的服务器直接拉取，应在包设置中明确将可见性改为 Public。保留私有时，在服务器用具有该包读取权限的账号及 `read:packages` 权限的 classic token 执行 `docker login ghcr.io`。参见 [GitHub Container registry 文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

镜像首次发布成功且已具备读取权限后：

```sh
docker pull ghcr.io/maretu01/gothrough:latest
docker run -d --name gothrough --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  ghcr.io/maretu01/gothrough:latest
```

镜像发布使用 GitHub 自动提供的 `GITHUB_TOKEN`，仅发布任务开启 `packages: write`，无需填写 Docker Hub 用户名或密码。若发布时遇到 403，检查仓库/组织是否限制 Actions 的包写入；如果曾手动创建同名包，还需在该包的 Actions access 设置中授予本仓库访问权限。工作流不会自动修改包的可见性，也不会自动部署或更新你的服务器。

## 启动容器

```sh
docker run -d --name gothrough \
  --stop-timeout 40 \
  -p 8080:8080 \
  --mount type=volume,source=gothrough-data,target=/data \
  gothrough:local
```

访问 `http://localhost:8080`。容器以 UID/GID `10001:10001` 运行。程序退出时可获得最多 40 秒的停止宽限期，配合应用自身的 30 秒请求等待时间。

### 使用 Compose

```sh
docker compose up -d --build
docker compose logs -f
docker compose down
```

Compose 挂载项目的 `config/config.yaml` 为只读配置，并创建统一的数据卷。`docker compose down` 默认保留数据卷；`docker compose down -v` 会删除卷及其中上传文件。

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
/app/uploads           符号链接 → /data/uploads
/app/temp_uploads      符号链接 → /data/temp_uploads
/data/                 单个持久化数据卷
```

当前后端根据可执行文件位置确定数据目录；镜像通过两个符号链接，将上传文件和临时文件统一落到 `/data`。这样无需改变应用现有目录规则，且升级镜像不会从数据卷读取旧版本可执行文件。

**必须将整个 `/data` 挂载为同一个卷。** 不要把 `uploads` 和 `temp_uploads` 分别挂载为两个卷，也不要单独将临时目录放入 tmpfs；上传完成依赖跨目录硬链接，两个独立挂载点会导致发布失败。数据卷底层文件系统也必须支持硬链接。服务启动仍会清理临时上传，容器重启不提供上传续传。

默认推荐 Docker 管理的 named volume。使用宿主机 bind mount 时，需预先确保 UID/GID `10001:10001` 能创建和读写两个子目录；镜像不会在启动时自动修改宿主机目录权限。同一个卷不要同时供多个应用实例处理上传会话。

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

同一容器名的示例是替代方案，不要同时执行。配置修改后需重启或重新创建容器。端口和 TLS 的完整规则见[配置说明](configuration.md)。

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
