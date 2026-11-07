# AGENTS.md

## 项目与适用范围

GoThrough 是 Go + Gin 后端与 React + TypeScript SPA 组成的文件和文本共享工具，支持分块上传、文件管理、文件夹 ZIP 下载、预览与文本编辑、共享剪贴板及可选访问口令。发布版将前端嵌入 Go 可执行文件，也支持 Docker 部署。

本文件用于约束仓库内的开发工作。修改子系统前先读相关文档与现有实现；详细原理、配置表和操作步骤保留在对应文档中，避免在这里重复。保持本文件简洁，每个普通段落使用一行源文本。

## 事实来源

| 内容 | 以此为准 |
| --- | --- |
| 构建命令、工具版本与依赖 | [Makefile](Makefile)、[go.mod](go.mod)、[前端清单](frontend/package.json)、[锁文件](frontend/package-lock.json)、[.nvmrc](.nvmrc) |
| 启动、服务组装与关闭 | [cmd/main.go](cmd/main.go)、[存储初始化](internal/app/storage.go) |
| 配置项、默认值与验证 | [internal/config/](internal/config/)、[配置模板](config/config.yaml) |
| HTTP 路由、请求与响应 | [路由注册](internal/router/router.go)、[处理器](internal/handler/)、[数据模型](internal/model/types.go) |
| 上传、文件与剪贴板行为 | [服务层](internal/service/)、[传输与接口说明](doc/transfer.zh-CN.md) |
| 前端结构与国际化 | [前端指南](frontend/README.zh-CN.md)、[路由](frontend/src/router.tsx)、[国际化实现](frontend/src/i18n/) |
| CI、打包与发布 | [工作流](.github/workflows/)、[构建说明](doc/build.zh-CN.md)、[Docker 说明](doc/docker.zh-CN.md) |

文档与代码不一致时，先核对实际行为及测试，不要仅为迎合过时示例修改正确实现。不要将访问口令、会话、证书私钥或其他真实凭据写入代码、输出或提交。

## 按任务阅读和验证

以下命令默认在仓库根目录执行。安装、完整检查和发布的详细步骤见[构建与检查](doc/build.zh-CN.md)。

| 任务 | 先阅读 | 相关验证 |
| --- | --- | --- |
| 后端与 HTTP 接口 | [目录与分层](doc/architecture.zh-CN.md)、[传输与接口](doc/transfer.zh-CN.md) | 受影响包的 Go 测试、`go vet ./...`；接口变更同时验证前端调用 |
| 配置、启动与目录 | [配置说明](doc/configuration.zh-CN.md)、`internal/config/`、`internal/app/` | 配置、存储初始化和启动测试；核对默认值与路径解析 |
| 上传、完成确认、取消与清理 | [传输与接口](doc/transfer.zh-CN.md)、上传服务与前端传输引擎 | 服务层、处理器、传输引擎和队列相关测试；并发改动补充 race 检查 |
| 前端功能与样式 | [前端指南](frontend/README.zh-CN.md)、相关页面和公共组件 | `npm --prefix frontend run lint`、相关前端测试、`npm --prefix frontend run build`；布局改动检查不同屏幕尺寸 |
| 日志 | [日志与排错](doc/logging.zh-CN.md)、`internal/logging/` | 日志相关测试，检查字段、脱敏与错误响应 |
| 打包、Docker 与发布 | [构建说明](doc/build.zh-CN.md)、[Docker 说明](doc/docker.zh-CN.md) | 相关构建与工作流检查；镜像改动验证容器运行及数据持久化 |
| 仅文档 | 引用的源文件及对应中英文文档 | 核对链接、命令与事实，执行 `git diff --check` |

按改动范围运行检查，避免无关的重复验证。新增测试应覆盖实际行为和回归风险，不要只复述实现。交付时说明已执行的检查、结果和未验证的平台；模拟尺寸、交叉编译不等于真机测试。

## 环境、开发与构建产物

- 工具版本以仓库文件为准。前端使用 npm 和现有锁文件；安装使用 `npm --prefix frontend ci`，不要无故更换包管理器、升级依赖或重写锁文件。
- `make install` 准备 Go 和前端依赖。Makefile 使用 POSIX shell，Windows 在 Git Bash 中执行；系统命令为 `mingw32-make` 时替换 `make`。
- 本地开发分别运行 `go run ./cmd` 和 `npm --prefix frontend run dev`。Vite 将 `/api` 默认代理到 `http://127.0.0.1:9815`；自定义地址沿用 `GOTHROUGH_DEV_API_TARGET`。
- `make build` 构建前端、刷新嵌入资源并生成 `release/` 下的程序。仅执行前端 build 不会更新已发布的可执行文件；普通 `go run ./cmd` 不嵌入 SPA。
- `frontend/dist/`、`internal/webassets/dist/` 和 `release/` 是生成或本地运行目录，不手工编辑或提交其中的产物。不要把 `node_modules/`、上传数据、剪贴板内容、日志及本地证书纳入提交。
- `config/config.yaml` 是受版本控制的配置模板；`release/config/config.yaml` 是本地运行配置。修改项目默认配置时更新模板、默认值、验证和文档，不覆盖已有本地运行配置。
- `make test` 包含前端构建、lint、测试，以及普通和 `embedweb` 两种模式的 Go 测试与 vet。`make test-race` 需要 CGO 和 C 编译器；直接运行带 `embedweb` 的 Go 检查前须先生成嵌入资源。
- `make clean` 会删除生成目录和输出程序，不要与构建或测试并行运行；不要为了普通验证清理用户运行数据。

## 后端、路径与数据规则

- 保持 `config.Load → app.PrepareStorage → 服务 → 处理器 → 路由` 的组装顺序。配置与证书验证成功后才准备和清理存储；`PrepareStorage` 仅用于启动。
- 数据目录通过构造参数传入服务，保持每个实例的存储隔离，不引入进程级可变目录变量。HTTP 处理器负责请求和响应，服务层维护相对路径策略、根目录约束及普通文件检查。
- 文件操作复用现有 `os.Root`、目录句柄和路径验证，不使用字符串前缀判断代替目录约束。文件名与目录参数视为不可信输入，保持符号链接和特殊文件检查。
- 下载和预览通过对应服务的 `OpenFile` 获取文件，处理器关闭返回的句柄并处理 Range 和响应头。文件夹 ZIP 保持流式输出、取消响应及下载限额，不为方便实现生成整份临时 ZIP。
- API 统一在 `internal/router/router.go` 注册。新增受保护接口沿用会话和同源检查；保持明确的认证入口例外、可信代理设置及请求限制。
- 错误响应复用现有处理方式，保留稳定的 `code` 和面向用户的 `error`，完整原因交给日志；不要直接向客户端返回未知底层错误或存储细节。新增错误码同步更新前端双语翻译。
- 上传发布、路径预留、编辑、删除和目录回收共享协调关系；不要仅为拆文件或拆类型引入彼此独立的锁。完成、取消和过期复用资源释放流程，过期检查不能等待活跃传输。
- 上传完成确认保持幂等。取消后才到达的初始化响应仍需保留会话 ID 用于清理；结果未确认时重试原会话，不能重新初始化并重复上传。
- 保留文件列表、剪贴板的 ETag 与条件请求语义，以及文本编辑的版本冲突检查、草稿恢复和原子替换。变更持久化结构时考虑已有数据的兼容与恢复，不静默清空用户数据。
- Go 代码使用 `gofmt`，跨平台文件操作沿用现有平台拆分。新增后台任务遵循上下文取消和关闭流程，避免请求结束后遗留工作。

## 前端与界面规则

- 页面沿用 `src/pages/` 与 `src/router.tsx`，API 访问放在 `src/services/`，公共行为复用现有 Hook 和组件。新增页面同步更新 [SPA 回退路由](internal/router/web.go) 和 [导航配置](frontend/src/layouts/Navigation.tsx)。
- 上传队列属于应用级 Provider，站内切换页面后继续运行。`features/upload/engine.ts` 保持独立于 React 与翻译模块，Hook 负责调度、React 快照、计时和提示。
- 文案使用 `useTranslation()`，同步维护 `zh-CN.json` 和 `en.json` 的 key、插值与复数。长生命周期状态保存 `message(key, values)` 描述，渲染时翻译，不在模块初始化时保存译文。
- 复用公共 `Button`、`Select`、状态提示、预览及确认组件。图标按钮提供可访问名称，表单保留标签、键盘操作和可见焦点；菜单和弹窗关闭后合理恢复焦点。
- 保留手机端可折叠导航、当前页面提示和进行中的上传状态。新增入口统一维护 `navigationItems`，不要分别维护桌面与手机两套列表。
- 布局改动检查窄屏手机、平板宽度和桌面，必要时检查横屏与英文长文案。内容不应撑出视口；确需横向滚动的表格或代码限制在自身容器，浮层在低高度屏幕中可滚动。
- 后台刷新沿用页面可见性、请求取消、过期响应处理和交互暂停机制；保留已有内容与用户操作状态，不因后台失败清空页面或覆盖操作提示。
- 上传文件和剪贴板内容始终按不可信数据处理。保留安全的文本展示和预览限制，不执行上传的 HTML、SVG 或代码，不用未清理的内容直接生成 HTML。

## Git、PR 与发布

- 开始工作先检查分支和工作区，保留用户已有改动。默认使用独立的 `feat/`、`fix/` 或 `docs/` 分支，经 PR 合并到 `main`；已有任务分支可继续使用，用户明确要求直接推送时按其要求执行。
- 提交聚焦当前任务，不混入无关格式化、依赖更新或生成文件。提交信息沿用 `feat:`、`fix:`、`docs:`、`chore:` 等仓库现有风格。
- PR 描述说明具体问题、最终行为和验证结果。合并前检查 CI；不要把本地测试通过描述为远程 CI 已通过。
- 提交、推送、创建 PR、合并和版本发布按用户授权范围执行。只有用户明确要求发布版本时才创建并推送标签，不自行递增版本号或覆盖已有标签。
- `v*` 标签触发发布工作流，标签提交必须已包含在远程 `main` 中。GitHub Release 工作流生成草稿；Docker 标签发布是独立流程，不能将草稿生成等同于正式发布或镜像发布成功。

## 文档与范围控制

用户可见行为、配置、接口或部署方式变化时，在同一改动中维护对应文档及其中英文版本。详细职责见[目录与分层](doc/architecture.zh-CN.md)，配置表留在配置文档，发布步骤留在构建与 Docker 文档。

优先沿用现有架构和依赖。除非任务需要，不额外引入数据库、账户体系、桌面外壳、原生手机客户端或新的服务层级。实现当前需求，避免将假设中的后续功能一并加入。
