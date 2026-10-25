# 端口与 TLS 配置

[返回项目首页](../README.md)

本页命令均在项目根目录执行。运行配置位于 `config/config.yaml`。

## 配置文件

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

## 环境变量

| 环境变量 | 用途 |
| --- | --- |
| `GOTHROUGH_CONFIG` | 指定配置文件路径，低于 `-config` |
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

## 前端开发代理

Vite 开发代理独立于后端配置。如果后端改到 9000 端口，可启动：

```sh
GOTHROUGH_DEV_API_TARGET=http://127.0.0.1:9000 npm --prefix frontend run dev
```

该变量也可写入 `frontend/.env.local`（需重启 Vite）。嵌入版前端使用同源 `/api`，不需要额外配置代理；证书和后端环境变量不会发送到浏览器。
