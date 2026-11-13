# GoThrough Frontend

English | [简体中文](README.zh-CN.md)

[Back to the project README](../README.md)

React, TypeScript, and Vite frontend with upload, file list, and shared clipboard pages.

## Development and Checks

See the [build requirements](../doc/build.md#requirements). Start `go run ./cmd` from the project root, then run these commands from `frontend`:

```sh
npm ci
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:9815` by default; see the [development proxy configuration](../doc/configuration.md#frontend-development-proxy) to change it. The default release embeds the frontend in Go and needs no additional proxy. Separate frontend deployments require an `/api` reverse proxy and page route fallback.

```sh
npm test
npm run build
npm run lint
```

Tests use Vitest, jsdom, and React Testing Library. See [checks and CI](../doc/build.md#checks-and-continuous-integration) for project-wide validation.

## Code Entry Points

| Path | Responsibility |
| --- | --- |
| `src/pages/`, `src/router.tsx` | Pages and routing |
| `src/config/features.ts` | Shared feature definitions for lazy routes, navigation entries, and home cards |
| `src/contexts/UploadQueueProvider.tsx` | Application-level queue that continues across in-app navigation |
| `src/hooks/useUploadQueue.ts` | Queue scheduling, React snapshots, clocks, and page lifecycle |
| `src/features/upload/task.ts` | Own task mutations and notifications; expose read-only state and progress collections |
| `src/features/upload/engine.ts` | Single-file protocol, chunk concurrency, retries, and completion without React |
| `src/hooks/useRemoteData.ts`, `useAutoRefresh.ts` | Loading, background refresh, stale responses, and request cancellation |
| `src/services/` | API calls and error presentation; transport cancellation lives in `src/utils/cancellation.ts` |
| `src/config/` | Upload settings and clipboard refresh interval |
| `src/i18n/` | Translation resources, language detection, and message descriptors |
| `src/components/`, `src/styles/` | Shared components and styles |

Add features to `src/config/features.ts` and the Go SPA fallback allowlist in `internal/router/web.go`; shared definitions store translation keys. Update uploads through named `UploadTask` methods; the task and engine have no React or localization runtime dependencies. See [state ownership](../doc/architecture.md#frontend-state).

Requests, responses, and recovery rules belong to [Transfer and APIs](../doc/transfer.md). Pages call `src/services/`; tests use server-paginated responses.

File lists use cards at widths up to 1024px and tables on wider screens. Desktop action columns have bounded widths and wrapping confirmation controls. Browser tests cover both sides of the breakpoint, Chinese/English labels, and deletion confirmation, checking that action buttons stay inside the viewport.

## Browser workflow tests

After installing npm dependencies, run:

```sh
npm exec -- playwright install chromium webkit
npm run test:e2e
```

Run these commands in `frontend`. Playwright starts an isolated Go API on port 19815 and Vite on 5183; neither port may already be in use. It builds a test executable and writes disposable configuration and data under ignored `.e2e-runtime/`, without loading local deployment configuration or inheriting `GOTHROUGH_*` overrides. Test output and failure traces go to ignored `test-results/`. Stop test processes before removing these generated directories.

The suite covers desktop Chromium, mobile Chromium, and mobile-size WebKit: navigation and language switching, upload/preview/edit/download, multi-select ZIP downloads and deletion, manual clipboard fallback, cancelling and confirming logout during a transfer, and server-side pagination/search. These are browser emulations, not native-device certification. CI installs browser dependencies with `--with-deps` and runs the suite separately from Vitest; `make test` does not run browser tests.

## Internationalization

The frontend uses `i18next` and `react-i18next` with Simplified Chinese and English. Follow these translation conventions.

- `src/i18n/index.ts`: initialization, language detection, persistence, and HTML `lang` synchronization.
- `src/i18n/locales/zh-CN.json`, `en.json`: translation resources bundled with the app.
- `src/i18n/messages.ts`: message descriptors translated at render time.

Use `useTranslation()` in components to obtain `t`. Static text uses the Chinese source as its key, such as `t('上传文件')`. Translate sentences containing parameters as a whole with named keys, such as `t('files.deleted', { name })`, using `{{name}}` interpolation in dictionaries. English counts use `_one` and `_other` plural forms.

Do not translate at module initialization. Store upload status, API errors, and success notices with `message(key, values)`, then call `translateMessage()` when rendering so existing notices follow language changes.

API errors retain `error` and provide a stable `code`. `apiErrorDescriptor()` prefers the `errors.<code>` translation and falls back to the original error for unknown codes. Add translations in both languages when introducing an error code.

To add a language:

1. Add a language JSON file with matching keys and interpolation parameters.
2. Register its resources, supported language, and detection rules in `src/i18n/index.ts`.
3. Add an option using the language's own name in `src/components/LanguageSwitcher.tsx`.
4. Run the tests, build, and lint commands above. Regular tests use Chinese; language switching has separate coverage.
