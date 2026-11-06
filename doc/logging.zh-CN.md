# 日志

[English](logging.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

后端默认向标准输出写入文本日志，可配置 JSON 格式及滚动文件。

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

修改后重启生效。启用文件输出时，无法创建或打开日志文件会导致启动失败；运行中写入或轮转失败会报告 `logging.file_failed`，控制台输出仍保留。

## 排错步骤

1. 在浏览器开发者工具中找到失败请求，从响应头复制 `X-Request-ID`。
2. 在控制台或日志文件中搜索对应的 `request_id`，查看状态码和完整错误原因。接口响应仅提供公开提示，系统路径等细节需查看日志。
3. 上传问题可继续按 `session_id` 搜索关联事件，分块请求另有 `chunk_index`；剪贴板操作可按 `entry_id` 关联。

访问日志包含 `method`、`route`、`status`、`duration_ms`、`remote_ip` 和 `response_bytes`。`remote_ip` 来自 TCP 连接，反向代理部署时通常是代理地址。每个请求由服务端生成新的请求 ID。

日志不主动记录文件内容、剪贴板正文或 Authorization 头；文件事件可能包含相对文件名，存储错误可能包含磁盘路径，分享日志前请检查这些字段。

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
