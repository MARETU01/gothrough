# GoThrough 前端

[English](README.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

React + TypeScript + Vite 前端，包含上传、文件列表和共享剪贴板页面。

## 本地开发与检查

环境要求见[构建说明](../doc/build.zh-CN.md#环境要求)。先在项目根目录运行 `go run ./cmd`，再在 `frontend` 目录执行：

```sh
npm ci
npm run dev
```

Vite 默认将 `/api` 代理到 `http://127.0.0.1:9815`；修改目标地址见[开发代理配置](../doc/configuration.zh-CN.md#前端开发代理)。默认发布方式由 Go 嵌入前端，无需额外配置代理；前后端分开部署时，需配置 `/api` 反向代理和页面路由回退。

```sh
npm test
npm run build
npm run lint
```

测试使用 Vitest、jsdom 和 React Testing Library。完整项目检查及 CI 范围见[构建与检查](../doc/build.zh-CN.md#检查与持续集成)。

## 代码入口

| 路径 | 职责 |
| --- | --- |
| `src/pages/`、`src/router.tsx` | 页面及路由 |
| `src/config/features.ts` | 懒加载路由、导航入口和首页卡片共用的功能定义 |
| `src/contexts/UploadQueueProvider.tsx` | 应用级上传队列，支持站内切换页面后继续上传 |
| `src/hooks/useUploadQueue.ts` | 队列调度、React 快照、计时与页面生命周期 |
| `src/features/upload/task.ts` | 拥有任务状态修改和通知，对外提供只读状态及进度集合 |
| `src/features/upload/engine.ts` | 不使用 React 的单文件协议、分块并发、重试和完成确认 |
| `src/hooks/useRemoteData.ts`、`useAutoRefresh.ts` | 数据加载、后台刷新、过期响应处理与请求取消 |
| `src/services/` | API 调用与错误展示；传输取消判断位于 `src/utils/cancellation.ts` |
| `src/config/` | 上传参数及剪贴板刷新间隔 |
| `src/i18n/` | 翻译资源、语言检测与消息描述 |
| `src/components/`、`src/styles/` | 公共组件与样式 |

新增功能先修改 `src/config/features.ts`，再同步 `internal/router/web.go` 的 SPA 回退白名单；共用定义保存翻译 key。上传状态通过 `UploadTask` 的具名方法更新，任务与引擎不依赖 React 或翻译运行时；详细边界见[架构说明](../doc/architecture.zh-CN.md#前端状态)。

请求、响应和恢复规则统一见[传输与接口](../doc/transfer.zh-CN.md)；页面通过 `src/services/` 调用接口，测试使用服务端分页响应。

文件列表在宽度不超过 1024px 时使用卡片，较宽屏幕使用表格；桌面操作列限制宽度，确认按钮组可换行。浏览器测试覆盖断点两侧、中英文及删除确认状态，检查操作按钮完整位于视口内。

## 浏览器流程测试

安装 npm 依赖后，在 `frontend` 目录执行：

```sh
npm exec -- playwright install chromium webkit
npm run test:e2e
```

Playwright 启动独立的 Go API（19815 端口）和 Vite（5183 端口），这两个端口不能已被占用。测试编译可执行文件，并在忽略的 `.e2e-runtime/` 下生成独立配置和数据，不读取本地部署配置，也不继承 `GOTHROUGH_*` 覆盖设置。测试输出和失败追踪放在忽略的 `test-results/`。删除这些生成目录前应先停止测试进程。

测试覆盖桌面 Chromium、手机 Chromium 和手机尺寸 WebKit：导航与语言切换，上传、预览、编辑、下载，多选 ZIP 下载与删除，手动复制降级，上传中取消及确认退出，以及服务端分页和搜索。这些属于浏览器模拟，不等于真机认证。CI 使用 `--with-deps` 安装浏览器依赖，并在 Vitest 之外独立运行；`make test` 不包含浏览器测试。

## 国际化

使用 `i18next` 和 `react-i18next`，支持简体中文和英文。翻译约定如下。

- `src/i18n/index.ts`：初始化、语言检测、存储及 HTML `lang` 同步。
- `src/i18n/locales/zh-CN.json`、`en.json`：随应用打包的翻译资源。
- `src/i18n/messages.ts`：保存消息描述，渲染时翻译。

组件使用 `useTranslation()` 获取 `t`。静态文案以中文原文作 key，例如 `t('上传文件')`；含参数的整句使用命名 key，例如 `t('files.deleted', { name })`，字典通过 `{{name}}` 插值。英文数量使用 `_one`、`_other` 复数形式。

不要在模块初始化时生成译文。上传状态、接口错误和成功提示通过 `message(key, values)` 保存描述，渲染时调用 `translateMessage()`，使已有提示跟随语言切换。

接口错误保留 `error` 并提供稳定的 `code`。`apiErrorDescriptor()` 优先使用 `errors.<code>` 翻译；未知错误码回退到原始错误信息。新增错误码时同步补齐两种语言资源。

新增语言时：

1. 添加语言 JSON，保持 key 和插值参数一致。
2. 在 `src/i18n/index.ts` 中注册资源、支持语言和检测规则。
3. 在 `src/components/LanguageSwitcher.tsx` 添加以该语言自身名称显示的选项。
4. 执行上述测试、构建和 lint。常规测试固定使用中文，语言切换另有测试覆盖。
