# 服务与数据目录配置

[English](configuration.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

本页命令均在项目根目录执行。运行配置位于 `config/config.yaml`。

## 配置文件

外部配置文件 `config/config.yaml`：

```yaml
storage:
  data_dir: ".."
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

字段优先级：**环境变量 > YAML 配置 > 内置默认值**。TLS 开关通过 `server.tls.enabled` 或 `GOTHROUGH_TLS_ENABLED` 设置。环境变量中的空字符串也视为明确覆盖，空端口或无效布尔值会报错。

日志通过 `logging` 配置，支持级别、文本 / JSON 格式、成功访问日志开关和可选滚动文件；详细参数及环境变量见[日志说明](logging.zh-CN.md)。日志文件相对路径以数据根目录为基准。

## 数据目录

`storage.data_dir` 指定数据根目录，包含 `uploads/`、`temp_uploads/` 和 `clipboard/`。相对路径以配置文件所在目录为基准；未加载配置文件时，环境变量中的相对路径以工作目录为基准。默认配置填写 `".."`，因此开发数据保存在项目根目录，发布包的数据保存在 `release/` 中。

如果配置文件和环境变量均未指定数据目录，使用可执行文件所在目录。使用 `go run` 时，请通过配置或环境变量指定数据目录，避免写入临时可执行文件目录。空字符串和纯空白的数据目录会被拒绝。

可通过 `GOTHROUGH_DATA_DIR` 覆盖数据目录，例如 `GOTHROUGH_DATA_DIR="D:/GoThroughData" go run ./cmd`。修改目录不会自动搬迁旧数据；需要在服务停止后自行迁移，或继续指向原目录。一个数据根目录只供一个服务进程使用。

## 环境变量

| 环境变量 | 用途 |
| --- | --- |
| `GOTHROUGH_CONFIG` | 指定配置文件路径，低于 `-config` |
| `GOTHROUGH_DATA_DIR` | 数据根目录，覆盖 `storage.data_dir`；不能为空 |
| `GOTHROUGH_HOST` | 监听 IP 或主机名，不含协议和端口；IPv6 不加方括号 |
| `GOTHROUGH_PORT` | 监听端口，范围 1～65535 |
| `GOTHROUGH_TLS_ENABLED` | TLS 开关，建议填写 `true` / `false` |
| `GOTHROUGH_TLS_CERT_FILE` | PEM 证书链文件路径 |
| `GOTHROUGH_TLS_KEY_FILE` | PEM 私钥文件路径 |

文件和环境变量提供的相对证书路径使用同一规则；未加载配置文件时相对于工作目录解析。环境变量指进程环境，后端不会自动读取 `.env`。

## 启动示例

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

## 图片剪贴板

```yaml
clipboard:
  image:
    enabled: true
    max_size_mb: 10
    max_pixels: 20000000
    max_total_size_mb: 200
```

`max_size_mb` 同时限制上传图片和规范化 PNG 的字节数（1–50 MiB）；`max_pixels` 限制宽 × 高（1–40000000）；`max_total_size_mb` 限制历史中图片的总大小（不得小于单张上限，最大 10240 MiB）。超过总容量时拒绝新图片，不自动清空历史。降低限制不删除已有记录。图片解码最多同时执行一次，繁忙时返回 429。`enabled: false` 仅禁止新增图片，不影响已有图片和文本功能。

| 环境变量 | 对应配置 |
| --- | --- |
| `GOTHROUGH_CLIPBOARD_IMAGE_ENABLED` | `clipboard.image.enabled` |
| `GOTHROUGH_CLIPBOARD_IMAGE_MAX_SIZE_MB` | `clipboard.image.max_size_mb` |
| `GOTHROUGH_CLIPBOARD_IMAGE_MAX_PIXELS` | `clipboard.image.max_pixels` |
| `GOTHROUGH_CLIPBOARD_IMAGE_MAX_TOTAL_SIZE_MB` | `clipboard.image.max_total_size_mb` |

前端从接口读取实际限制，配置修改后重启生效。

## 剪贴板数据

文本和图片元数据保存在数据根目录的 `clipboard/history.json`，图片位于 `clipboard/images/`；它们与上传文件分开存储，不出现在文件列表中。备份、恢复或迁移时，请停止服务并处理整个 `clipboard/` 目录。一个数据根目录只供一个服务进程使用。

服务启动时检查历史和图片是否有效。历史损坏、图片缺失或与元数据不匹配时，启动报错并保留历史文件；请检查日志并恢复备份。历史加载成功后会清理无引用的程序图片文件。

图片统一转为 PNG，不保留原图元数据（包括 JPEG EXIF 方向）；删除、清空和超出最近 100 条的自动淘汰会同时清理对应图片。

## 前端开发代理

Vite 开发代理独立于后端配置。如果后端改到 9000 端口，可启动：

```sh
GOTHROUGH_DEV_API_TARGET=http://127.0.0.1:9000 npm --prefix frontend run dev
```

该变量也可写入 `frontend/.env.local`（需重启 Vite）。嵌入版前端使用同源 `/api`，不需要额外配置代理；证书和后端环境变量不会发送到浏览器。
