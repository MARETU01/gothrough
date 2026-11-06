# 传输与接口

[English](transfer.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

## 上传与文件接口

后端接口统一使用 `/api` 前缀。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/upload/init` | 初始化上传 |
| POST | `/api/upload/chunk` | 上传分块 |
| GET | `/api/upload/status/:session_id` | 查询上传进度 |
| POST | `/api/upload/complete` | 完成上传 |
| POST | `/api/upload/cancel` | 取消上传 |
| GET | `/api/files` | 获取文件列表 |
| GET | `/api/files/*filename` | 下载文件，支持 Range 请求 |
| DELETE | `/api/files/*filename` | 删除文件 |
| GET | `/api/disk-info` | 获取磁盘信息 |

文件名作为 URL 路径参数时需要编码。

## 剪贴板接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/clipboard` | 获取最新记录，返回 `entries` 数组 |
| POST | `/api/clipboard` | 发布文本，JSON 请求体为 `{"text":"共享内容"}` |
| DELETE | `/api/clipboard/:id` | 删除单条记录 |
| DELETE | `/api/clipboard` | 清空全部记录 |
| GET | `/api/clipboard/image-config` | 获取图片开关及实际限额 |
| POST | `/api/clipboard/image` | 以 multipart 字段 `image` 发布一张 PNG/JPEG |
| GET | `/api/clipboard/:id/image` | 获取 PNG；加 `?download=1` 下载 |

发布成功返回创建的记录。记录包含 `id` 和 `created_at`，`type` 标识记录类型，兼容旧数据时缺省值按文本处理。文本记录包含 `text`，图片记录包含 `image` 元数据。文本以纯文本处理，单条最多 65,536 个 UTF-8 字节；文本和图片合计保留最近 100 条。

剪贴板响应使用 `Cache-Control: no-store`。列表提供 `ETag`，使用 `If-None-Match` 可在内容未变时获得无正文的 `304`；内容变化时返回完整列表。

图片限额、解码并发和存储恢复规则见[配置说明](configuration.zh-CN.md#图片剪贴板)。

## 上传流程

1. 调用初始化接口，传入文件名、大小和可选的 `relative_path`，取得会话、分块大小及传输方式。
2. 按返回的分块大小上传。`upload_transport: "raw"` 表示使用 `application/octet-stream` 请求体；未声明该能力时使用 multipart。服务端也兼容 multipart 客户端。
3. 全部分块上传后调用完成接口，服务端校验大小和分块完整性后保存文件；取消任务调用取消接口。

文件夹上传通过 `relative_path` 保留顶层目录及子目录，例如 `资料/照片/图片.jpg`。文件列表、下载和删除使用相对于上传目录的路径，URL 路径参数需要编码。空文件夹不保存，同名冲突自动改名，不覆盖已有内容。

## 限制与错误

| 项目 | 限制或行为 |
| --- | --- |
| 默认传输参数 | 8 MiB 分块；前端每个文件 3 路并发，同时处理 2 个文件 |
| 单文件大小 | 最大 1 TiB |
| 服务端容量 | 最多同时接收 16 个块，保留 1024 个活跃会话；超限返回 429 |
| 相对路径 | 最多 32 层、4096 字节；每段清洗后最多 200 个 UTF-8 字节，含扩展名及冲突后缀 |
| 路径校验 | 拒绝绝对路径、目录穿越和符号链接；无效路径返回 400，父路径冲突返回 409 |
| 存储要求 | 临时目录与上传目录位于同一个支持硬链接的文件系统 |
| 磁盘检查 | 初始化检查可用空间，但不预留容量，并发上传仍可能耗尽空间 |
| 存储错误 | 空间或配额不足返回 507，权限不足返回 403，只读文件系统返回 503 |
| 会话过期 | 每 5 分钟清理闲置超过 24 小时的会话，正在写入的会话除外 |
| 重启与续传 | 会话保存在内存；重启清空临时上传，不支持重启后的续传 |
| 下载 | 支持 Range 请求 |

请求失败时可通过响应头 `X-Request-ID` 查找服务端日志，详见[日志排错](logging.zh-CN.md#排错步骤)。
