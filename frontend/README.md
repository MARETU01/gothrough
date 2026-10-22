# GoThrough 前端

React + TypeScript + Vite 文件上传界面。支持拖拽和多文件选择、分块并发、当前页面内暂停/恢复、取消、单文件重试，以及进度和速度展示。

## 本地开发

在 `frontend` 目录执行：

```sh
npm ci
npm run dev
```

开发服务器将 `/api` 请求代理到 `http://127.0.0.1:8080`。先在仓库根目录执行 `go run ./cmd` 启动 Go 上传服务。生产部署需要自行配置 `/api` 反向代理，以及前端路由回退到 `index.html`。

## 检查

```sh
npm test
npm run build
npm run lint
```

测试使用 Vitest、jsdom 和 React Testing Library，覆盖取消、暂停/恢复、队列移除、失败重试、并发退出、分块乱序、速度采样、展示快照和空文件进度。

## 代码组织

- `src/pages/Upload`：上传页面与独立文件行。
- `src/hooks/useUploadQueue.ts`：队列调度、并发和生命周期。
- `src/services/upload.ts`：初始化、分块、合并、取消接口。
- `src/config/upload.ts`：分块大小和并发配置。
- `src/types/upload.ts`：内部任务类型和只读展示类型。
- `src/utils/upload.ts`：字节进度和展示快照。

暂停会等待当前分块请求结束，并阻止后续分块与文件启动。离开上传页面会取消当前队列；刷新后的断点恢复尚未实现。取消初始化中的任务后，会在初始化响应返回时清理会话；服务端仍需为网络断开等情况提供会话过期清理。文件列表和下载功能暂未开放。
