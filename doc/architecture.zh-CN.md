# 目录与分层

[English](architecture.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

## 职责划分

| 位置 | 职责 |
| --- | --- |
| `cmd/main.go` | 组装依赖、运行 HTTP 和清理任务、处理关闭 |
| `internal/config/`、`internal/app/storage.go` | 校验配置，再准备实例级存储 |
| `internal/router/` | 路由、认证和中间件 |
| `internal/handler/upload.go` | 上传 HTTP 协议及请求并发限制 |
| `internal/handler/file_handler.go`、`files.go`、`edit.go`、`folder_download.go` | 文件 HTTP 响应、预览、流式传输及 JSON/ETag 缓存 |
| `internal/service/file_service.go` | 协调文件修改和共享状态 |
| `internal/service/upload_session.go`、`completion.go` | 上传会话、分块、完成结果和资源释放 |
| `internal/service/files.go`、`text.go`、`folder*.go` | 安全文件操作、编辑、目录管理和 ZIP 生成 |
| `internal/service/file_listing.go`、`file_browser.go` | 列表版本、目录查询和磁盘信息 |
| `internal/service/clipboard*.go` | 剪贴板历史、图片和持久化 |
| `internal/utils/` | 文件名、磁盘及平台文件系统操作 |
| `frontend/src/features/upload/` | 任务状态与传输协议，不依赖 React 或翻译运行时 |
| `frontend/src/hooks/useUploadQueue.ts` | 队列调度、React 快照、计时、生命周期及提示 |

## 启动与存储

启动顺序为 `config.Load → app.PrepareStorage → 服务 → 处理器 → 路由`。先校验配置和证书，再准备及清理存储；目录通过构造参数传入，`PrepareStorage` 仅在启动时运行。

服务负责路径校验、`os.Root` 根目录约束及普通文件检查。下载处理器调用服务的 `OpenFile`，关闭返回的句柄，并处理响应头、Range 和预览。上传与文件处理器共用一个 `FileService`，统一协调发布、路径预留、编辑、删除和目录回收。

## 锁与资源释放

完成、取消、过期共用资源释放流程。嵌套持锁顺序为 `session.lifecycle → FileService.mu → session.mu/listingMu`；分块写入采用 `lifecycle.RLock → block lock → session.mu`。查询先释放服务锁，再获取生命周期锁；列表扫描不获取修改锁或会话锁。过期检查先在服务锁内复制引用，再使用 `lifecycle.TryLock`，不等待活跃传输。

## 查询与 HTTP 响应

服务返回类型化数据和列表版本。`ListingSnapshot` 持有不可变版本，获取时不复制条目，`Data()` 返回独立副本；扫描未发现变化时保留版本。浏览查询最多缓存 32 页，仅保留对应页的条目。

`FileHandler` 缓存 JSON 和查询专属 ETag。命中时跳过数据副本创建，未命中时在缓存锁外编码和计算哈希。并发未命中可重复编码，但旧版本不能覆盖新缓存。校验值由查询与内容决定，相同响应在缓存失效后仍保留相同 ETag。

处理器共用 `errors.go` 的存储错误映射，各操作提供独立的兜底错误码和消息，完整原因保留在日志中。固定上传限制归 `service/limits.go`，multipart 解析限制归路由，部署设置归 `config/`。

## 前端状态

应用级 Provider 使上传跨页面继续运行。队列和引擎共享 `UploadTask`：调用方读取属性和集合，具名生命周期操作统一更新相关字段并通知。字节进度节流发布，分块确认立即通知，计时和速度采样批量生成 React 快照。

初始化响应迟到时仍保留会话，以便取消清理；完成结果不确定时沿用原会话确认，不重新上传。Hook 负责 React 更新、计时、提示和卸载处理。代码入口及国际化见[前端开发](../frontend/README.zh-CN.md)，协议与恢复规则见[传输说明](transfer.zh-CN.md)。
