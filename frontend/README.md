# GoThrough Frontend

English | [简体中文](README.zh-CN.md)

[Back to the project README](../README.md)

A file upload interface built with React, TypeScript, and Vite. It supports drag-and-drop and multi-file selection, concurrent chunked uploads, pause and resume within the current browser session, cancellation, individual file retries, and progress and speed displays.

## Local Development

Use Node.js 26 LTS (26.13.0 or a newer 26.x version) and its accompanying npm. Run `nvm use 26` from the repository root to switch versions. After upgrading from an older Node.js version, first run `make -B install` from the root to force dependency reinstallation.

From the `frontend` directory:

```sh
npm ci
npm run dev
```

The development server proxies `/api` requests to `http://127.0.0.1:8080`. Start the Go upload service first by running `go run ./cmd` from the repository root. For a separate production frontend deployment, configure a reverse proxy for `/api` and route fallback to `index.html` for frontend pages.

## Checks

```sh
npm test
npm run build
npm run lint
```

Tests use Vitest, jsdom, and React Testing Library. They cover cancellation, pause and resume, queue removal, retries, concurrent worker shutdown, out-of-order chunks, speed sampling, display snapshots, and empty-file progress.

## Code Organization

The upload page displays elapsed time for each file and the current queue run, updating every 500 ms and retaining final results after completion. Per-file timing starts at initialization and excludes queue waiting. Queue timing starts when the run begins and measures elapsed time across concurrent tasks rather than adding individual file durations. Timing includes preparation, transfer, validation, and saving. All time between clicking pause and resuming is excluded, including time while existing requests are still finishing. Cancellation freezes the clock; restarting or retrying starts a new clock, and clearing the queue removes timing data. In-app navigation does not interrupt timing.

- `src/pages/Upload`: upload page and individual file rows.
- `src/hooks/useUploadQueue.ts`: queue scheduling, concurrency, and lifecycle.
- `src/services/upload.ts`: initialization, chunk upload, completion, and cancellation endpoints.
- `src/services/errors.ts`: shared HTTP error parsing and cancellation detection.
- `src/hooks/useRemoteData.ts`: shared loading, refreshing, and request cancellation for file lists and the clipboard. It ignores stale responses and cancels requests on unmount. Background refreshes do not show a loading state or clear action errors; synchronization failures are tracked separately.
- `src/hooks/useAutoRefresh.ts`: schedules the next poll after the current request completes. It cancels background requests when the page is hidden or operations pause polling, and synchronizes immediately when the page becomes visible again.
- `src/config/clipboard.ts`: clipboard refresh interval, defaulting to 3000 ms.
- `src/hooks/usePageTitle.ts`: sets the page title and restores it when leaving.
- `src/config/upload.ts`: chunk size and concurrency settings.
- `src/types/upload.ts`: internal task types and read-only display types.
- `src/utils/upload.ts`: byte progress and display snapshots.

Pausing lets active chunk requests finish and prevents subsequent chunks and files from starting. The queue is managed by the application-level `UploadQueueProvider`, so uploads continue during in-app navigation. Return to the upload page to view progress and control tasks. When tasks are unfinished, including pending, failed, or paused tasks, refreshing, closing, or leaving the site triggers the browser's leave warning. The warning is no longer requested once all tasks succeed or the queue is cleared. The browser controls the message and whether to show it, usually requiring prior user interaction. Confirming navigation away discards the queue; resuming after refresh is not implemented. If a task is cancelled during initialization, its session is cleaned up when the initialization response arrives. The server still needs session expiration to handle cases such as network disconnection.

The `/files` page provides a storage overview, filename search, sorting by name, size, or modification time, pagination with 20 entries per page, downloads, and deletion confirmation within the button. The first click changes the label to the Chinese equivalent of "Confirm deletion?"; clicking again within 3 seconds deletes the file, while waiting longer resets the button. The list is fetched from `/api/files`. Downloads and deletion use the existing backend endpoints, and storage information is refreshed after deletion.

The `/clipboard` page automatically fetches the latest entries through `GET /api/clipboard`, waiting 3 seconds after each request completes before polling again. Polling pauses during publishing, deletion, deletion confirmation, copying, and while the manual copy panel is open. Polls are skipped when text is selected. Returning to a visible page triggers an immediate fetch; hiding or unmounting the page cancels background requests. Polling does not overwrite drafts, reset deletion confirmation, cause loading flashes, or clear action errors. Network failures preserve the current list and are retried automatically. Manual refreshes can take priority over background requests.

The upload page, file list, and clipboard share `Button`, `StatusMessage`, and Lucide icons. Shared interaction styles are in `src/styles/interactions.css`, covering primary, secondary, destructive, and loading states. Shared page container styles for the file list and clipboard are in `src/styles/global.css`. Repeated operations are disabled while deletion is being submitted.
