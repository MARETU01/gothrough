# 日志

[返回项目首页](../README.md)

后端使用 Go 标准库 `log/slog`，默认向标准输出写入文本日志；启动、业务事件、HTTP 请求和错误统一使用时间、级别、消息及结构化字段。前端控制台的请求失败提示独立于后端日志，不会自动上报。

## 配置

```yaml
logging:
  level: "info"
  format: "text"
  access_log: true
  log_polling: false
  log_chunks: false
  file:
    enabled: false
    path: "logs/gothrough.log"
    max_size_mb: 10
    max_backups: 5
```

- `level`：`debug`、`info`、`warn`、`error`，只输出达到该级别的记录。`debug` 额外记录闲置会话扫描等诊断事件。
- `format`：`text` 适合直接阅读，`json` 每条记录占一行，适合日志收集。
- `access_log`：控制成功请求的访问日志。关闭后，失败请求仍按 WARN（4xx）或 ERROR（5xx）记录，并遵守 `level`；上传完成、剪贴板发布等业务事件独立于这个开关。
- `log_polling`：是否记录成功的剪贴板列表和上传状态查询请求，默认关闭。
- `log_chunks`：是否记录成功的分块请求，默认关闭。高频请求失败时仍保留日志。
- `file.enabled`：额外写入滚动文件，默认关闭，控制台输出始终保留。
- `file.path`：相对路径以 `storage.data_dir` 为基准；支持绝对路径。不能放在 `temp_uploads` 内，以免启动清理删除日志。
- `file.max_size_mb`：单个文件的目标大小，按 MiB 计算，范围 1～1024。单条记录超过限制时保持完整，不拆分 JSON。
- `file.max_backups`：保留 1～100 个历史文件，默认 5 个，另有一个当前文件。历史文件为 `gothrough.log.1`、`.2` 等，`.1` 最新；超出数量删除最旧文件。

修改后重启生效。配置或证书校验失败时不会创建日志文件；日志系统尚未初始化的错误使用基础文本格式输出到控制台。启用文件输出后，创建或打开文件失败会使启动失败。运行中发生文件写入或轮转失败时，控制台仍保留日志，并报告 `logging.file_failed`，同一次持续失败只提示一次。

## 请求与业务关联

每个 HTTP 请求都会生成新的 `request_id`，并通过响应头 `X-Request-ID` 返回；客户端传入的同名请求头不会被直接采用。可在浏览器开发者工具的响应头中找到它，再搜索相同字段定位业务事件和请求结果。

访问日志包含 `method`、`route`（路由模板）、`status`、`duration_ms`、`remote_ip`、`response_bytes`，失败时附带已记录的错误原因。`remote_ip` 来自 TCP 连接地址，反向代理部署时通常是代理的地址，不直接采用转发头。

上传、文件和剪贴板接口不会直接返回底层错误字符串。内部错误返回简洁的操作失败提示；磁盘空间不足、存储权限不足、会话失效等已知错误保留明确的业务提示，不附带包装错误中的磁盘路径和系统细节。完整原因记录在请求日志中，可通过响应头 `X-Request-ID` 关联定位。上传完成失败时的 `error` 和 `message` 字段使用相同的公开提示。

上传创建、完成和取消事件关联 `session_id`，完成时记录文件大小和会话耗时（毫秒，开始时间精度为秒）。上传状态及分块请求可关联有效 UUID 会话 ID，分块请求还记录 `chunk_index`。后台清理和服务关闭产生的事件没有 HTTP 请求 ID，但关联会话 ID 或清理数量。

剪贴板发布记录 `entry_id` 和 `size_bytes`，删除和清空记录操作结果。日志不主动记录请求正文、文件内容、剪贴板正文、Authorization 头、完整查询字符串或 panic 值；panic 记录类型和调用栈。文件删除事件可包含相对文件名，存储错误可能包含磁盘路径。

常见事件：`server.started`、`server.stopping`、`server.stopped`、`server.failed`、`http.request`、`http.panic`、`upload.started`、`upload.completed`、`upload.cancelled`、`upload.expired`、`upload.cleanup_failed`、`clipboard.created`、`clipboard.deleted`、`clipboard.cleared`。

## Docker 与直接运行

Docker 默认仅使用控制台日志：

```sh
docker compose logs -f --tail=100
```

Compose 为 Docker 日志设置每个文件 `10m`、最多 `3` 个文件的轮转策略。它与应用内文件输出的大小和保留数量分别管理。需要机器可读格式时可设置 `GOTHROUGH_LOG_FORMAT=json`，无需启用应用内日志文件。

直接运行程序时，启用 `logging.file.enabled` 后，默认文件位于数据目录的 `logs/gothrough.log`。新目录权限为 0700，新文件权限为 0600（实际权限受系统及 umask 影响）；重新启动会追加到已有文件。Docker 内启用该能力时默认写入 `/data/logs`，由现有数据卷保存。

## 环境变量

环境变量优先于 YAML，空值同样参与校验：

| 环境变量 | 对应配置 |
| --- | --- |
| `GOTHROUGH_LOG_LEVEL` | `logging.level` |
| `GOTHROUGH_LOG_FORMAT` | `logging.format` |
| `GOTHROUGH_ACCESS_LOG` | `logging.access_log` |
| `GOTHROUGH_LOG_POLLING` | `logging.log_polling` |
| `GOTHROUGH_LOG_CHUNKS` | `logging.log_chunks` |
| `GOTHROUGH_LOG_FILE_ENABLED` | `logging.file.enabled` |
| `GOTHROUGH_LOG_FILE_PATH` | `logging.file.path` |
| `GOTHROUGH_LOG_FILE_MAX_SIZE_MB` | `logging.file.max_size_mb` |
| `GOTHROUGH_LOG_FILE_MAX_BACKUPS` | `logging.file.max_backups` |
