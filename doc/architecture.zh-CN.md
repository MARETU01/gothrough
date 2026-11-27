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
| `internal/handler/file_handler.go`、`files.go`、`edit.go`、`selection.go` | 文件 HTTP 响应、预览、流式传输及 JSON/ETag 缓存 |
| `internal/service/file_service.go` | 协调文件修改和共享状态 |
| `internal/service/upload_session.go`、`completion.go` | 上传会话、分块、完成结果和资源释放 |
| `internal/service/files.go`、`text.go`、`folder*.go`、`selection*.go` | 安全文件操作、编辑、目录管理和 ZIP 生成 |
| `internal/service/spreadsheet.go` | 受限 XLSX 解析、单元格类型修改，以及通过共用文件协调器按版本原子发布 |
| `internal/service/save_operation.go`、`spreadsheet_save.go`、`text.go` | 在文件修改协调器下共用有界回执及文本、表格的幂等保存 |
| `internal/service/file_listing.go`、`file_browser.go` | 列表版本、目录查询和磁盘信息 |
| `internal/service/clipboard*.go` | 剪贴板历史、图片和持久化 |
| `internal/utils/` | 文件名、磁盘及平台文件系统操作 |
| `frontend/src/features/upload/` | 任务状态与传输协议，不依赖 React 或翻译运行时 |
| `frontend/src/hooks/useUploadQueue.ts` | 队列调度、React 快照、计时、生命周期及提示 |

## 启动与存储

启动顺序为 `config.Load → app.PrepareStorage → 服务 → 处理器 → 路由`。校验配置和证书后，先占用监听端口，再准备存储。`PrepareStorage` 取得数据根目录的操作系统独占锁后，才检查存储并清理临时上传，锁在服务关停后释放。剪贴板独立初始化，失败时仅剪贴板接口返回 `503 CLIPBOARD_UNAVAILABLE`。

服务负责路径校验、`os.Root` 根目录约束及普通文件检查。下载处理器调用服务的 `OpenFile`，关闭返回的句柄，并处理响应头、Range 和预览。上传与文件处理器共用一个 `FileService`，统一协调发布、路径预留、编辑、删除和目录回收。

## 锁与资源释放

完成、取消、过期共用资源释放流程。嵌套持锁顺序为 `session.lifecycle → FileService.mu → session.mu/listingMu`；分块写入采用 `lifecycle.RLock → block lock → session.mu`。查询先释放服务锁，再获取生命周期锁；列表扫描不获取修改锁或会话锁。过期检查先在服务锁内复制引用，再使用 `lifecycle.TryLock`，不等待活跃传输。

递归删除在同一个 `FileService.mu` 下预留路径，目录扫描和子项删除在锁外执行，最终移除目录和回收祖先时重新持锁；同时最多处理 2 个文件夹。上传初始化、文本保存、其他删除及目录回收检查同一组预留，同路径互斥，不相关路径继续运行。取消或失败均释放预留；路径校验与 `os.Root` 约束保持不变。

## 查询与 HTTP 响应

服务返回类型化数据和列表版本。`ListingSnapshot` 持有不可变版本，获取时不复制条目，`Data()` 返回独立副本；扫描未发现变化时保留版本，并将扫描间隔从 2 秒逐步延长至最多 30 秒；发现变化或业务变更使缓存失效后恢复初始间隔。手动刷新立即重新校验，内容未变时保留版本，不创建后台扫描任务。浏览查询最多缓存 32 页，仅保留对应页的条目。

`FileHandler` 缓存 JSON 和查询专属 ETag。命中时跳过数据副本创建，未命中时在缓存锁外编码和计算哈希。并发未命中可重复编码，但旧版本不能覆盖新缓存。校验值由查询与内容决定，相同响应在缓存失效后仍保留相同 ETag。

扫描时保存原生时间值，列表与目录排序直接比较时间，不在比较器中重复解析 RFC3339；HTTP 时间字段保持原格式。磁盘接口只复制缓存中的文件数和总字节数，再查询磁盘空间，不复制完整文件清单。

处理器共用 `errors.go` 的存储错误映射，各操作提供独立的兜底错误码和消息，完整原因保留在日志中。固定上传限制归 `service/limits.go`，请求体限制归 HTTP 处理器，部署设置归 `config/`。

接口字段、传输限制和恢复规则见[传输与接口](transfer.zh-CN.md)。

## 前端状态

`SpreadsheetPreview` 在现有预览弹窗内按需加载，显示分页值网格，单元格修改存入现有编辑草稿 Provider。XLSX 解析和序列化在文件修改锁外执行，使用实例内并发准入；发布按 `FileService.mu → listingMu` 顺序加锁，并在替换前复核源文件版本。协议和限额见传输指南。

`SpreadsheetGrid` 缓存行和单元格，按行和地址索引修改。`MediaPreview` 管理可取消的诊断探测，每次重试重置查看器状态。文本与表格草稿均保留不可变保存请求，共用回执存储及发布协调，各自处理预览加载界面。

编辑草稿区分文本与表格，表格保留有明确类型的修改和不可变保存请求，不再将其编码进文本字段。修改清单和地址栏驱动页码、滚动和焦点更新。工作簿原子发布在同一修改锁内登记有界回执；未确认操作在登录恢复后沿用原标识、版本和内容。回执确认与后续预览加载分开处理，后续修改或预览失败不会触发再次发布。

文件页单项与批量删除共用请求防重、逐项结果处理和后台刷新流程，刷新失败保留已完成操作的提示。长时间删除使用 AbortController，不设前端固定超时并提供中止操作，离开页面也会取消请求；结果未确认时后台重新同步，不假定操作已回滚。

应用级 Provider 使上传跨页面继续运行。队列和引擎共享 `UploadTask`：调用方读取属性和集合，具名生命周期操作统一更新相关字段并通知。字节进度节流发布，分块确认立即通知，计时和速度采样批量生成 React 快照。

上传队列位于访问门禁外层。登录过期时中断当前请求并暂停调度，保留文件和上传会话。重新解锁后按服务端分块状态继续，主动锁定退出清空队列。初始化响应迟到时仍保留会话以便清理或恢复。完成结果不确定时沿用原会话确认，收到明确的缺块响应时每次尝试最多自动补传一轮。Hook 负责 React 更新、计时、提示和卸载处理。详见[前端开发](../frontend/README.zh-CN.md)和[传输说明](transfer.zh-CN.md)。
