# GoThrough

Go + Gin 文件上传服务，配套 React + TypeScript 前端。

## 本地启动

在仓库根目录启动后端：

```sh
go run ./cmd
```

后端默认监听 `http://localhost:8080`。另开终端启动前端：

```sh
cd frontend
npm ci
npm run dev
```

前端通过 Vite 将 `/api` 请求代理到后端。

## 目录

- `cmd/main.go`：后端启动入口。
- `internal/`：配置、路由、处理器、上传服务与模型。
- `internal/utils/disk*.go`：基于标准库的统一磁盘容量查询，支持 Windows、Linux、macOS 和 FreeBSD；其他系统返回不支持错误。
- `frontend/`：React 前端，详见 `frontend/README.md`。
- `uploads/`、`temp_uploads/`：运行时数据，不纳入 Git。

页面由 React 前端提供，Go 后端只提供接口，不依赖 HTML 模板。`/api/files` 返回 JSON 文件列表，下载与删除接口继续保留。

开发时从根目录运行；部署编译后的程序时，运行时上传目录位于可执行文件旁。当前服务启动会清理临时分块。

## 传输实现

上传使用 8MiB 分块，前端每个文件 3 路并发、同时处理 2 个文件。初始化返回 `upload_transport: "raw"`，新版前端将 Blob 作为 `application/octet-stream` 请求体直接发送；未声明该能力的旧服务端仍使用 multipart。旧 multipart 客户端也可以继续请求新版后端，需采用初始化返回的分块大小。

后端通过 `io.CopyBuffer` 和偏移写入，把每块直接写入同一个临时文件，复用 256KiB 缓冲，不将整块读入内存，也不再读出全部分块合并。完成前校验分块数量和文件大小、执行 Sync，再用不覆盖现有文件的硬链接发布。临时目录与上传目录必须位于同一个支持硬链接的文件系统，例如同一 NTFS/ext4 分区；不支持的文件系统会明确返回发布错误，保留会话供重试或取消。下载继续使用标准库文件服务，支持 Range 请求。

会话独立控制并发，重复块不会覆盖已确认数据；最多同时接收 16 个块、保留 1024 个活跃会话，超限返回 429。单文件上限 1TiB。每 5 分钟清理闲置超过 24 小时的会话，正在写入的会话不会被清理。会话保存在内存，服务重启仍会清空临时上传，不提供重启后的续传。

默认关闭逐请求访问日志，设置 `GOTHROUGH_ACCESS_LOG=1` 可开启。服务器设置请求头、请求体和空闲连接超时；退出时最多等待 30 秒让已有请求结束，再关闭连接并清理临时会话。

## 检查

```sh
go test ./...
go build ./...
```
