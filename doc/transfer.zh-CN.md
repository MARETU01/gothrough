# 传输与接口

[English](transfer.md) | 简体中文

[返回项目首页](../README.zh-CN.md)

## 页面操作

- 通过路径导航、搜索、排序和分页浏览文件。搜索覆盖全部文件并显示完整路径，清除后返回当前目录；URL 的 `dir` 保留位置，支持刷新和前进、后退。空目录从列表消失后回退到仍存在的上级；手机和平板显示文件卡片。
- 文件列表在请求完成 3 秒后更新，磁盘信息每 15 秒独立更新，保留数据和筛选状态。删除确认、删除请求及预览编辑期间暂停，选中文本时跳过；页面隐藏时取消后台请求，重新显示时刷新。失败保留数据和操作提示；手动刷新及编辑、删除成功后刷新两者。
- 预览支持图片、UTF-8 文本、PDF 和浏览器支持的音视频，无法显示时可下载。Esc 关闭弹窗，手机使用全屏视图；剪贴板图片共用弹窗，查看期间暂停自动更新。
- 有未完成上传时，锁定退出须确认：确认后中断传输并清空队列，取消则继续运行。刷新浏览器或重启服务后不能续传。
- 勾选文件或文件夹后，可下载 ZIP 或删除所选；“全选当前页”最多选中当前 20 项。切换目录、搜索、排序、页码或手动刷新会清空选择；勾选期间暂停自动刷新。删除前显示数量、名称及递归范围，取消会保留选择，部分失败时保留失败项供重试。

## 认证接口

接口统一使用 `/api`。开启口令后，文件、上传、磁盘和剪贴板接口均需会话，浏览器修改请求还需通过同源检查。Cookie、代理配置和登录限流见[访问口令](configuration.zh-CN.md#访问口令)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/auth/status` | 返回 `enabled`、`authenticated` |
| POST | `/api/auth/login` | 提交 `{"password":"<口令>"}`，获取会话 Cookie |
| POST | `/api/auth/logout` | 撤销当前会话并清除 Cookie |

## 上传与文件接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/upload/init` | 初始化上传 |
| POST | `/api/upload/chunk` | 上传分块 |
| GET | `/api/upload/status/:session_id` | 查询进度或完成结果 |
| POST | `/api/upload/complete` | 校验并发布文件 |
| POST | `/api/upload/cancel` | 取消并清理会话 |
| GET | `/api/files` | 获取文件列表 |
| GET | `/api/files/*filename` | 下载或预览，支持 Range |
| PUT | `/api/files/*filename` | 携带版本保存文本 |
| GET | `/api/disk-info` | 获取磁盘信息 |
| GET | `/api/batch-download?path=a&path=docs` | 流式下载所选文件及文件夹 ZIP |
| POST | `/api/batch-delete` | 批量删除，逐项返回结果 |

URL 中的路径和查询参数需要 URL 编码；JSON 请求体中的路径使用原始值。

### 文件查询

`GET /api/files` 返回服务端分页结果；`view` 可省略或设为 `browser`，其他值返回 `400 INVALID_FILE_QUERY`。查询参数为 `dir`（相对目录，默认根目录）、`q`（不区分大小写的完整路径搜索，最多 1024 字节）、`sort`（默认 `mtime_desc`）、`page`（正整数，默认 1）和 `page_size`（1–100，默认 20）。排序支持 `mtime_asc`、`mtime_desc`、`size_asc`、`size_desc`、`name_asc`、`name_desc`。

例如 `/api/files?dir=docs&page=2&page_size=20` 返回 `docs` 的直接子项，文件夹优先；搜索覆盖全部目录。名称排序不区分大小写，以完整路径打破同序关系，不依赖浏览器语言。不存在的目录回退到仍存在的上级，越界页码收敛到最后一页。

响应必含 `files`（`name`、`size`、`size_display`、`mtime`、`folder`、`label`）、实际 `directory`、匹配总数 `total` 和 `folder_count`、全站 `total_files` 和 `total_size_display`，以及 `page`、`page_size`、`total_pages`。时间使用含时区的 RFC3339，界面按本地时间显示。

磁盘信息独立通过 `GET /api/disk-info` 获取，包含总量、已用、可用值及显示值，`disk_pct`、`disk_pct_warning` 和上传总量。

列表使用 `Cache-Control: no-store` 和查询专属 ETag；同一查询发送 `If-None-Match`，未变化返回无正文的 `304`。仅复用已接受的版本，手动刷新获取完整数据。上传、编辑和删除使缓存失效，外部变更在 2 秒扫描缓存过期后反映；磁盘变化不影响 ETag。缓存实现见[架构说明](architecture.zh-CN.md#查询与-http-响应)。

### 批量操作

删除统一使用 `POST /api/batch-delete`，单项也传数组：`{"entries":[{"path":"docs","folder":true},{"path":"note.txt","folder":false}]}`。最多 100 项，请求体 512 KiB；非法路径或重复选择在任何删除前返回 `400 INVALID_FILE_SELECTION`。

合法请求返回 HTTP `200` 和 `results` 数组；每项含 `path`、`deleted`，失败项另含 `code`、`error`。单项调用也须检查匹配结果的 `deleted`：不存在为 `FILE_INACCESSIBLE`，类型变化为 `SELECTION_CHANGED`，文件夹内有未完成上传为 `FOLDER_BUSY`；其他项继续处理。

`folder: true` 递归删除全部后代。符号链接和特殊文件会使该项失败，不跟随链接。整批及单个文件夹删除均不保证原子性，不回滚已删内容；失败后先刷新检查再重试。

最多同时递归删除 2 个文件夹，超额项返回 `DELETION_BUSY`，批量请求的 HTTP 状态仍为 200。删除中的路径被预留：重叠的上传初始化或文本保存返回 `409 PATH_BUSY`，删除项返回 `PATH_BUSY`；不相关路径可继续操作，取消或失败后释放预留。

### 文件夹 ZIP 下载

`GET /api/batch-download?path=a.txt&path=docs` 选择上传目录内的 1–100 个文件或文件夹；单个文件夹也使用此接口。查询字符串最多 64 KiB，不支持选择上传根目录。全部顶层路径校验成功后才开始响应。

压缩包名为 `files.zip`，保留完整上传相对路径，父子项重叠时去重。文件夹包含全部层级，不受搜索或分页限制；已有空子目录会打包，符号链接和特殊文件不跟随或打包。

ZIP 直接流式发送，不生成临时压缩包，不支持 Range 或源文件快照。下载期间避免修改源文件；读取失败或断连会中断传输，需要重试。最多同时生成 2 个 ZIP，并计入共享的 32 个下载名额，超限返回 `429`。

### 文件预览

`GET /api/files/*filename?preview=info` 返回 `kind`（`text`、`image`、`pdf`、`audio`、`video`）、`mime_type`、`text`；文本还返回 `version`。文本最多 1 MiB，超限返回 413，不支持的类型或编码返回 415。HTML、SVG 和代码按纯文本显示，不执行内容。

`?preview=1` 内联返回支持的内容，支持 Range。两种模式复用下载认证和路径校验，并禁止缓存。

### 文本编辑

向 `PUT /api/files/*filename` 提交 `{"text":"新内容","version":"<预览版本>"}`。成功返回新 `version`；缺少版本返回 428，内容已变化返回 409，文件已删除返回 404。冲突保留草稿，不提供强制覆盖。

支持保存后不超过 1 MiB 的 UTF-8 文本，大小包含 BOM 和换行。保留 BOM、权限及原文件首次出现的换行风格（LF、CRLF、CR）；内容不变时保留全部原始字节。文件原子替换，版本校验与服务内编辑、删除串行执行。每个数据目录仅供一个服务使用，保存期间避免外部写入。

放弃未保存内容或跳转前须确认，正在保存时等待请求完成；保存失败保留草稿。会话过期后草稿暂存在页面内存，重新解锁后沿用原版本恢复。刷新或关闭前会提示，但不会持久保存草稿。

## 剪贴板接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/clipboard` | 按新到旧返回 `entries` |
| POST | `/api/clipboard` | 发布文本：`{"text":"共享内容"}` |
| DELETE | `/api/clipboard/:id` | 删除一条记录 |
| DELETE | `/api/clipboard` | 清空全部记录 |
| GET | `/api/clipboard/image-config` | 获取图片开关和限额 |
| POST | `/api/clipboard/image` | 以 multipart 字段 `image` 发布 PNG/JPEG |
| GET | `/api/clipboard/:id/image` | 原始 PNG；`?download=1` 下载，`?thumbnail=1` 返回缩略图 |

发布成功返回记录，包含 `id`、`created_at`、显式 `type`（`text` 或 `image`）。文本记录含 `text`，图片记录含 `image` 元数据。合计保留最近 100 条，单条文本最多 65,536 个 UTF-8 字节。响应使用 `Cache-Control: no-store`，列表支持 ETag/`If-None-Match` 及无正文的 `304`。

PNG 缩略图最长边为 320 像素，复制和下载使用原图；缩略图缓存随记录删除、淘汰释放，重启后重建。图片限额、持久化及恢复规则见[配置说明](configuration.zh-CN.md#图片剪贴板)。

读取已有剪贴板历史时，缺省类型的文本记录由服务端在内存中补齐 `type: "text"`，不在启动时重写历史文件；后续正常写入会保存完整类型。记录 ID、正文和创建时间保持不变，响应始终包含显式类型。

## 上传流程

1. 使用文件名、大小和可选的 `relative_path` 初始化上传，获取会话和分块大小。
2. 分块统一使用 `application/octet-stream` 请求体，查询参数为 `session_id` 和从 0 开始的 `chunk_index`。不支持 multipart 分块，错误类型返回 `415 UNSUPPORTED_UPLOAD_TYPE`；分块大小必须使用初始化响应的 `chunk_size`。
3. 全部分块完成后调用完成接口，校验大小及分块完整性后发布；放弃任务调用取消接口。

JSON 请求及响应关键字段示例（`<UUID>` 替换为返回的会话 ID）：

| 操作 | 请求体 | 响应字段 |
| --- | --- | --- |
| 初始化 `note.txt` | `{"filename":"note.txt","total_size":5}` | `{"session_id":"<UUID>","chunk_size":8388608,"total_chunks":1,"final_filename":"note.txt"}` |
| 完成 | `{"session_id":"<UUID>"}` | `{"status":"success","saved_filename":"note.txt","size":5}` |

前端对临时错误最多退避重试两次并遵守 `Retry-After`；等待超过 60 秒则停止自动重试。永久请求或存储错误直接提示，取消立即中止等待。分块和完成请求不设前端超时。

完成接口幂等：最多保留 4096 条结果，最长 1 小时，不保留文件内容或分块映射。重复完成或查询状态返回原文件名、大小和 `status: "success"`；文件随后被删除也不会重新创建。结果在服务重启后丢失。

完成请求遇到临时错误时先查状态，再重试；手动重试沿用原会话，不重新上传。结果过期或服务重启后，先检查文件列表再决定重传。文件夹使用 `relative_path`（如 `docs/photos/image.jpg`）保留层级；空目录省略，同名冲突改名，不覆盖已有文件。

## 限制与错误

JSON 写入请求（登录、上传初始化/完成/取消、文本编辑、剪贴板文本和批量删除）统一拒绝未知字段，必须恰好包含一个 JSON 值。请求体限制内允许尾随空白，但会在执行变更前拒绝额外 JSON 或错误的尾随内容。登录请求体最多 2 KiB，超限返回 413。上传初始化必须显式提供 0 至 1 TiB 的整数 `total_size`：缺失或 `null` 无效，`0` 表示上传空文件。

| 项目 | 限制或行为 |
| --- | --- |
| 默认传输 | 8 MiB 分块；前端每文件 3 路、同时 2 个文件 |
| 单文件大小 | 最大 1 TiB |
| 上传 JSON | 初始化请求体 64 KiB，原文件名最多 4096 个 UTF-8 字节；完成、取消请求体 1 KiB，使用标准 UUID |
| 服务端容量 | 16 个并发分块、1024 个活跃会话；超限返回 429 |
| 相对路径 | 最多 32 层、4096 字节；清洗后每段最多 200 个 UTF-8 字节，含扩展名及冲突后缀 |
| 路径校验 | 拒绝绝对路径、目录穿越和符号链接；无效路径 400，父路径冲突 409 |
| 存储 | 临时与已发布文件共用支持硬链接的文件系统；初始化检查空间但不预留 |
| 存储错误 | 空间或配额不足 507，权限不足 403，只读 503 |
| 会话过期 | 每 5 分钟释放闲置超过 24 小时的会话，跳过活跃写入 |
| 目录回收 | 初始化失败、取消、过期、删除时仅回收服务创建的空祖先目录，保留预先存在或活跃使用的目录 |
| 重启 | 会话在内存中；启动清理临时上传，不支持续传 |
| 下载 | 文件、预览、剪贴板图片共用 32 个名额，满额返回 429；写入空闲超时 30 秒，随进度刷新，不限制总时长 |

错误响应提供稳定的 `code` 和面向用户的 `error`。通过 `X-Request-ID` 在[服务日志](logging.zh-CN.md#排错步骤)中查找完整原因。

删除存储错误统一使用：权限错误为 `STORAGE_PERMISSION`（403），只读存储为 `STORAGE_READ_ONLY`（503），空间或配额耗尽为 `STORAGE_FULL`（507）。批量失败在各项结果中返回错误码，有效批量请求的 HTTP 状态仍为 200。未知错误保留操作对应的兜底错误码，不暴露文件系统细节。
