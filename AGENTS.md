# AGENTS.md

## Project and scope

GoThrough is a file and text sharing tool with a Go + Gin backend and a React + TypeScript SPA. It supports chunked uploads, file management, folder ZIP downloads, previews and text editing, a shared clipboard, and optional password protection. Releases embed the SPA in a Go executable; Docker deployment is also supported.

Use this file for repository development constraints. Read the relevant guide and existing implementation before changing a subsystem. Keep detailed explanations, configuration tables, and procedures in their owning documents. Keep this file concise and write each prose paragraph on one source line.

## Sources of truth

| Subject | Authority |
| --- | --- |
| Build commands, tool versions, and dependencies | [Makefile](Makefile), [go.mod](go.mod), [frontend manifest](frontend/package.json), [lockfile](frontend/package-lock.json), [.nvmrc](.nvmrc) |
| Startup, service assembly, and shutdown | [cmd/main.go](cmd/main.go), [storage initialization](internal/app/storage.go) |
| Configuration keys, defaults, and validation | [internal/config/](internal/config/), [configuration template](config/config.yaml) |
| HTTP routes, requests, and responses | [route registration](internal/router/router.go), [handlers](internal/handler/), [wire models](internal/model/types.go) |
| Upload, file, and clipboard behavior | [services](internal/service/), [transfer and API guide](doc/transfer.md) |
| Frontend structure and localization | [frontend guide](frontend/README.md), [routes](frontend/src/router.tsx), [localization implementation](frontend/src/i18n/) |
| CI, packaging, and releases | [workflows](.github/workflows/), [build guide](doc/build.md), [Docker guide](doc/docker.md) |

When documentation and code disagree, verify actual behavior and tests first. Do not change working code just to match a stale example. Never put real passwords, sessions, certificate private keys, or other credentials in code, output, or commits.

## Read and verify by task

Commands run from the repository root unless stated otherwise. See the [build and verification guide](doc/build.md) for setup, complete checks, and release procedures.

| Task | Read first | Relevant verification |
| --- | --- | --- |
| Backend and HTTP API | [Architecture](doc/architecture.md), [transfer and API guide](doc/transfer.md) | Go tests for affected packages, `go vet ./...`; verify frontend callers when interfaces change |
| Configuration, startup, and paths | [Configuration](doc/configuration.md), `internal/config/`, `internal/app/` | Configuration, storage initialization, and startup tests; check defaults and path resolution |
| Uploads, completion confirmation, cancellation, and cleanup | [Transfer and API guide](doc/transfer.md), upload services, and frontend transfer engine | Relevant service, handler, transfer engine, and queue tests; add race checks for concurrency changes |
| Frontend features and styles | [Frontend guide](frontend/README.md), related pages and shared components | `npm --prefix frontend run lint`, relevant frontend tests, `npm --prefix frontend run build`; check different screen sizes for layout changes |
| Logging | [Logging and troubleshooting](doc/logging.md), `internal/logging/` | Logging tests; check fields, redaction, and error responses |
| Packaging, Docker, and releases | [Build guide](doc/build.md), [Docker guide](doc/docker.md) | Relevant build and workflow checks; verify container operation and data persistence for image changes |
| Documentation only | Referenced source files and corresponding English and Chinese documents | Verify links, commands, and facts; run `git diff --check` |

Run checks appropriate to the change and avoid unrelated repetition. New tests should cover observable behavior and regression risks rather than mirror implementation. Report what ran, its results, and any unverified platforms. Simulated screen sizes and cross-compilation are not native-device tests.

## Environment, development, and generated files

- Use the tool versions specified in repository files. The frontend uses npm and its existing lockfile; install with `npm --prefix frontend ci`. Do not change package managers, upgrade dependencies, or rewrite lockfiles without a reason.
- `make install` prepares Go and frontend dependencies. Makefile recipes use a POSIX shell; run them in Git Bash on Windows. Substitute `mingw32-make` if that is the installed command name.
- For local development, run `go run ./cmd` and `npm --prefix frontend run dev` separately. Vite proxies `/api` to `http://127.0.0.1:9815` by default; use `GOTHROUGH_DEV_API_TARGET` for a custom target.
- `make build` builds the frontend, refreshes embedded assets, and produces the executable under `release/`. A frontend build alone does not update an existing executable; plain `go run ./cmd` does not embed the SPA.
- `frontend/dist/`, `internal/webassets/dist/`, and `release/` contain generated assets or local runtime files. Do not edit or commit their contents manually. Keep `node_modules/`, uploaded data, clipboard contents, logs, and local certificates out of commits.
- `config/config.yaml` is the tracked template; `release/config/config.yaml` is local runtime configuration. When changing project defaults, update the template, defaults, validation, and documentation without overwriting existing local configuration.
- `make test` includes the frontend build, lint, and tests, plus Go tests and vet with and without `embedweb`. `make test-race` requires CGO and a C compiler. Generate embedded assets before directly running Go checks with `embedweb`.
- `make clean` removes generated directories and the output executable. Do not run it alongside builds or tests, and never clear user runtime data for routine verification.

## Backend, paths, and data rules

- Preserve the assembly order: `config.Load → app.PrepareStorage → services → handlers → router`. Validate configuration and certificates before preparing or cleaning storage. `PrepareStorage` is startup-only.
- Pass storage directories through service constructors and preserve isolation between instances. Do not introduce mutable process-wide directory variables. HTTP handlers own requests and responses; services own relative-path policy, root confinement, and regular-file checks.
- Reuse existing `os.Root`, directory handles, and path validation. Do not replace root confinement with string-prefix checks. Treat filenames and directory parameters as untrusted input and preserve checks for symbolic links and special files.
- Downloads and previews obtain files through the owning service's `OpenFile`; handlers close returned handles and manage Range requests and response headers. Keep folder ZIP downloads streaming, cancellable, and subject to download limits; do not generate complete temporary ZIP files for convenience.
- Register API routes in `internal/router/router.go`. New protected endpoints must retain session and same-origin checks. Preserve explicit authentication exceptions, trusted-proxy settings, and request limits.
- Reuse existing error handling with stable `code` values and deliberate user-facing `error` messages. Log full causes without exposing unknown underlying errors or storage details to clients. Add both frontend translations for new error codes.
- Upload publication, path reservations, editing, deletion, and directory reclamation share coordination. Do not introduce independent locks just to split files or types. Completion, cancellation, and expiration share resource-release logic; expiration checks must not wait for active transfers.
- Keep upload completion confirmation idempotent. An initialization response arriving after cancellation must still retain the session ID for cleanup. Retry the original session when completion is unconfirmed; do not initialize again and upload duplicates.
- Preserve file-list and clipboard ETag and conditional-request semantics, plus text-edit version checks, draft recovery, and atomic replacement. Consider compatibility and recovery when changing persistent formats; never silently erase user data.
- Format Go code with `gofmt` and follow existing platform-specific file splits for filesystem operations. Background tasks must participate in context cancellation and shutdown without leaving work behind after requests end.

## Frontend and UI rules

- Follow `src/pages/` and `src/router.tsx`, keep API calls in `src/services/`, and reuse shared Hooks and components. New pages must update [SPA fallback routes](internal/router/web.go) and [navigation configuration](frontend/src/layouts/Navigation.tsx).
- The upload queue belongs to an application-level Provider and keeps running across in-app navigation. Keep `features/upload/engine.ts` independent of React and localization; the Hook owns scheduling, React snapshots, timing, and notices.
- Render text through `useTranslation()` and keep keys, interpolation, and plurals aligned in `zh-CN.json` and `en.json`. Store `message(key, values)` descriptors in long-lived state and translate when rendering, never at module initialization.
- Reuse shared `Button`, `Select`, status, preview, and confirmation components. Give icon-only buttons accessible names, preserve form labels, keyboard support, and visible focus, and restore focus appropriately when menus or dialogs close.
- Preserve collapsible mobile navigation, the current-page label, and active upload status. Maintain feature routes, navigation entries, and home cards in `frontend/src/config/features.ts` instead of separate lists.
- Check narrow phones, tablet widths, and desktop layouts after layout changes, plus landscape and long English text where relevant. Content must not widen the viewport. Keep necessary horizontal scrolling inside table or code containers, and allow overlays to scroll on short screens.
- Reuse existing page-visibility handling, request cancellation, stale-response protection, and interaction pauses for background refreshes. Preserve data and user interaction state; background failures must not clear pages or overwrite action feedback.
- Treat uploaded files and clipboard contents as untrusted. Preserve safe text rendering and preview limits. Never execute uploaded HTML, SVG, or code, or insert unsanitized content as HTML.

## Git, PRs, and releases

- Check the branch and worktree before starting and preserve existing user changes. Default to separate `feat/`, `fix/`, or `docs/` branches merged into `main` through PRs. Reuse an existing task branch when appropriate; follow explicit user requests for direct pushes.
- Keep commits focused on the task. Avoid unrelated formatting, dependency updates, and generated files. Follow existing commit prefixes such as `feat:`, `fix:`, `docs:`, and `chore:`.
- PR descriptions explain the concrete problem, final behavior, and verification. Check CI before merging; do not describe passing local tests as passing remote CI.
- Commit, push, create PRs, merge, and release within the user's authorization. Create and push version tags only when the user explicitly requests a release. Do not independently increment versions or overwrite existing tags.
- `v*` tags trigger the release workflow, and the tagged commit must already be in remote `main`. The GitHub Release workflow creates a draft; Docker tag publishing is separate. A draft does not establish that a release is published or an image was successfully pushed.

## Documentation and scope

When user-visible behavior, configuration, APIs, or deployment changes, update the owning documents and their English and Chinese versions in the same change. Keep detailed responsibilities in [Architecture](doc/architecture.md), configuration tables in the configuration guide, and release procedures in the build and Docker guides.

Prefer existing architecture and dependencies. Unless required by the task, do not add a database, account system, desktop shell, native mobile client, or new service layer. Implement the current requirement without bundling hypothetical future features.
