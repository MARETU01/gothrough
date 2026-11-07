# 目录与分层

[English](architecture.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

| 位置 | 职责 |
| --- | --- |
| `cmd/main.go` | 加载设置、组装服务、启动 HTTP 和清理任务、处理关闭 |
| `internal/config/` | 只读配置加载与验证，以及运行参数默认值 |
| `internal/app/storage.go` | 启动时准备数据目录、验证存储并清理残留上传，返回独立的 `StoragePaths` |
| `internal/router/` | 路由、认证及中间件组装 |
| `internal/handler/` | 请求解析、错误响应、预览和 HTTP 文件传输 |
| `internal/service/upload_session.go` | 上传会话、分块、完成结果和生命周期 |
| `internal/service/files.go`、`text.go` | 相对路径策略、安全打开文件、删除及文本编辑 |
| `internal/service/file_listing.go` | 文件列表缓存和磁盘信息 |
| `internal/service/clipboard*.go` | 剪贴板历史、图片和持久化 |
| `internal/utils/` | 文件名、磁盘、平台硬链接等底层操作 |
| `frontend/src/features/upload/engine.ts` | 不使用 React 的单文件传输流程、分块并发和重试 |
| `frontend/src/hooks/useUploadQueue.ts` | 文件队列调度、React 快照、计时、页面生命周期和界面提示 |

启动过程为 `config.Load → app.PrepareStorage → 服务构造函数 → 处理器 → 路由`。目录通过构造参数传入；服务和处理器不读取进程级目录变量。`PrepareStorage` 只在启动时调用，不在请求处理中调用。配置校验完成后才执行目录清理。

下载处理器通过对应服务的 `OpenFile` 取得文件，由处理器关闭返回的句柄并处理响应头、Range 和预览。相对路径验证、根目录约束及普通文件检查由服务维护；底层操作继续使用 `os.Root` 和目录句柄。每个服务实例始终使用自己的目录。

上传发布、路径预留、目录回收、文本编辑和删除仍通过同一个服务协调。不要仅为了分文件或分类型而为这些操作引入独立的锁；锁的归属必须随共享状态一起设计。完成、取消和过期继续共用资源释放流程；过期检查不等待活跃传输。

前端传输引擎通过回调报告变化，Hook 决定如何更新 React、显示错误和处理卸载。初始化响应即使在取消后到达，也须保留会话 ID 以便清理。完成结果尚未确认时保留原会话，重试继续确认，不能重新初始化上传。传输引擎和取消判断不依赖界面翻译模块。

`config/config.yaml` 是受版本控制的模板，`release/config/config.yaml` 是本地运行配置；构建不会覆盖已有运行配置。`frontend/dist/` 和 `internal/webassets/dist/` 是生成文件。运行参数、接口、状态提示与数据布局保持兼容。
