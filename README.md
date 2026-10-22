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

## 检查

```sh
go test ./...
go build ./...
```
