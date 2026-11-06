# 界面国际化

前端使用 `i18next` 和 `react-i18next`，支持简体中文与英文。顶部导航的语言选择立即生效，刷新后保留选择。首次访问按浏览器语言选择，不支持的语言回退到简体中文；浏览器禁止本地存储时仍可切换。

## 翻译资源

- `frontend/src/i18n/index.ts`：初始化、语言检测、存储和 HTML `lang` 同步。
- `frontend/src/i18n/locales/zh-CN.json`、`en.json`：随应用打包的翻译资源，无需额外翻译服务。
- `frontend/src/i18n/messages.ts`：可延迟翻译的消息描述。

静态文案用中文原文作为 key，例如 `t('上传文件')`。含参数的文案用命名 key，例如 `t('files.deleted', { name })`，在字典中通过 `{{name}}` 插值。句子有变量时应整句翻译；英文数量使用 `_one`、`_other` 复数形式。

在 React 组件中通过 `useTranslation()` 取得 `t`，使组件跟随语言变化。不要在模块初始化时生成译文。上传状态、接口错误和成功提示使用 `message(key, values)` 保存描述，渲染时调用 `translateMessage()`，避免已显示的提示停留在旧语言。用户文件名、剪贴板内容和草稿保持原样。

## 接口错误

错误响应保留 `error`，并增加稳定的 `code`。前端 `apiErrorDescriptor()` 优先查找 `errors.<code>` 翻译；未知错误码或旧服务端响应保留原有错误信息。新增错误码时同时补齐两种语言资源。

## 新增语言

1. 添加语言 JSON，确保 key 和插值参数与现有资源一致。
2. 在 `i18n/index.ts` 中注册资源、支持语言和检测规则。
3. 在 `LanguageSwitcher.tsx` 增加使用该语言自身名称的选项。
4. 运行 `npm test`、`npm run build`、`npm run lint`。现有测试固定使用中文；切换行为另有测试覆盖。

界面切换不刷新页面、不重新挂载上传 Provider。剪贴板日期及数字按界面语言格式化；文件列表的修改时间由服务端提供，不对缺少时区的字符串进行时区转换。
