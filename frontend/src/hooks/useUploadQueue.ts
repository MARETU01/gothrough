import { message } from '@/i18n/messages';
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelUpload,
  completeUpload,
  initUpload,
  uploadChunk,
} from "@/services/upload";
import { apiErrorDescriptor, getErrorBody, isCanceledError } from "@/services/errors";
import type {
  UploadController,
  UploadItem,
  UploadViewItem,
  StatusMessage,
} from "@/types/upload";
import {
  CHUNK_SIZE,
  MAX_CONCURRENT_FILES,
  MAX_CONCURRENT_UPLOADS,
  PROGRESS_REFRESH_INTERVAL,
} from "@/config/upload";
import {
  createUploadSnapshot,
  getFileKey,
  recalcLoadedBytes,
  confirmChunk,
} from "@/utils/upload";
import { errorMessage } from "@/utils/misc";
import { uploadRetryDelay, waitForRetry } from "@/utils/uploadRetry";
import { createElapsedClock } from "@/utils/elapsed";
import { collectDroppedFiles, getUploadPath } from "@/utils/droppedFiles";

const cleanupSession = async (item: UploadItem) => {
  if (!item.session) return;
  try {
    await cancelUpload(item.session.sessionId);
  } catch {
    /* Server must expire abandoned sessions too. */
  }
};
const stopItem = (item: UploadItem) => {
  if (item.uploadController) {
    item.uploadController.cancelled = true;
    item.uploadController.abort.abort();
  }
};

export const useUploadQueue = () => {
  const itemsRef = useRef<UploadItem[]>([]);
  const globalPausedRef = useRef(false);
  const mountedRef = useRef(true);
  const runRef = useRef<{ cancelled: boolean } | null>(null);
  const wakeWaiters = useRef(new Set<() => void>());
  const wakeWorkers = useCallback(() => {
    for (const wake of wakeWaiters.current) wake();
    wakeWaiters.current.clear();
  }, []);
  const waitForChange = useCallback((signal?: AbortSignal) => new Promise<void>(resolve => {
    if (signal?.aborted) { resolve(); return; }
    const wake = () => {
      wakeWaiters.current.delete(wake);
      signal?.removeEventListener('abort', wake);
      resolve();
    };
    wakeWaiters.current.add(wake);
    signal?.addEventListener('abort', wake, { once: true });
  }), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const snapshotsRef = useRef(new WeakMap<UploadItem, UploadViewItem>());
  const clocksRef = useRef(new WeakMap<UploadItem, ReturnType<typeof createElapsedClock>>());
  const queueClockRef = useRef<ReturnType<typeof createElapsedClock> | null>(null);
  const [queueElapsedMs, setQueueElapsedMs] = useState<number | null>(null);
  const [items, setItems] = useState<UploadViewItem[]>([]);
  const [globalPaused, setGlobalPausedState] = useState(false);
  const [running, setRunning] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [readingDrops, setReadingDrops] = useState(0);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const refreshFileList = useCallback(() => {
    if (!mountedRef.current) return;
    if (queueClockRef.current) setQueueElapsedMs(queueClockRef.current.read());
    const next = itemsRef.current.map((item) => {
      const clock = clocksRef.current.get(item);
      if (clock) item.elapsedMs = clock.read();
      const snapshot = createUploadSnapshot(
        item,
        snapshotsRef.current.get(item),
      );
      snapshotsRef.current.set(item, snapshot);
      return snapshot;
    });
    setItems((previous) =>
      previous.length === next.length &&
      next.every((item, index) => item === previous[index])
        ? previous
        : next,
    );
  }, []);
  const setGlobalPaused = useCallback((paused: boolean) => {
    globalPausedRef.current = paused;
    if (!paused) wakeWorkers();
    if (mountedRef.current) setGlobalPausedState(paused);
  }, [wakeWorkers]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (runRef.current) runRef.current.cancelled = true;
      itemsRef.current.forEach(stopItem);
      wakeWorkers();
    };
  }, [wakeWorkers]);
  const hasUploading = items.some((i) => i.state === "uploading");
  const hasUnfinished = running || items.some((item) => item.state !== "success");
  useEffect(() => {
    if (!hasUnfinished) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      // Read live refs so a just-finished or just-cleared queue never warns.
      if (!runRef.current && !itemsRef.current.some((item) => item.state !== "success")) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnfinished]);
  useEffect(() => {
    if (!running || globalPaused || canceling) return;
    const samples = new WeakMap<UploadItem, { bytes: number; time: number }>();
    const started = Date.now();
    itemsRef.current.forEach(item => samples.set(item, { bytes: item.transferredBytes, time: started }));
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      itemsRef.current.forEach((item) => {
        const previous = samples.get(item) ?? { bytes: 0, time: now - 500 };
        const speed =
          item.state === "uploading" && !globalPausedRef.current
            ? (Math.max(0, item.transferredBytes - previous.bytes) * 1000) /
              Math.max(1, now - previous.time)
            : 0;
        samples.set(item, { bytes: item.transferredBytes, time: now });
        if (item.speed !== speed) {
          item.speed = speed;
          changed = true;
        }
      });
      if (changed || runRef.current) refreshFileList();
    }, 500);
    return () => clearInterval(timer);
  }, [refreshFileList, running, globalPaused, canceling]);
  const handleSelection = (files: FileList | File[]) => {
    const keys = new Set(itemsRef.current.map((i) => getFileKey(i.file)));
    Array.from(files).forEach((file) => {
      const key = getFileKey(file);
      if (keys.has(key)) return;
      itemsRef.current.push({
        file,
        state: "pending",
        error: "",
        session: null,
        speed: 0,
        savedFilename: "",
        uploadController: null,
        inflightBytes: new Map(),
        confirmedChunks: new Set(),
        confirmedBytes: 0,
        transferredBytes: 0,
        loadedBytes: 0,
        elapsedMs: null,
      });
      keys.add(key);
    });
    refreshFileList();
    setStatus(null);
  };
  const handleDrop = async (data: DataTransfer) => {
    setReadingDrops(count => count + 1);
    setStatus(null);
    try {
      const files = await collectDroppedFiles(data);
      if (!mountedRef.current) return;
      handleSelection(files);
      if (!files.length) setStatus({ text: message("upload.emptyFolder"), type: "error" });
    } catch (err) {
      if (mountedRef.current) setStatus({ text: message('upload.readFolderFailed', { error: errorMessage(err) }), type: "error" });
    } finally {
      if (mountedRef.current) setReadingDrops(count => count - 1);
    }
  };
  const uploadFileChunked = useCallback(
    async (item: UploadItem, run: { cancelled: boolean }) => {
      const controller: UploadController = {
        paused: false,
        cancelled: false,
        abort: new AbortController(),
      };
      item.uploadController = controller;
      const clock = createElapsedClock();
      clocksRef.current.set(item, clock);
      clock.resume();
      const isStopped = () =>
        run.cancelled ||
        controller.cancelled ||
        !mountedRef.current ||
        !itemsRef.current.includes(item);
      const checkActive = () => {
        if (isStopped() || controller.abort.signal.aborted)
          throw new Error("Upload cancelled");
      };
      const waitForResume = async () => {
        checkActive();
        while (globalPausedRef.current || controller.paused) {
          item.state = "paused";
          item.speed = 0;
          refreshFileList();
          await waitForChange(controller.abort.signal);
          checkActive();
        }
        item.state = "uploading";
        refreshFileList();
      };
      item.state = "initializing";
      item.error = "";
      item.speed = 0;
      item.session = null;
      item.savedFilename = "";
      item.inflightBytes.clear();
      item.confirmedChunks.clear();
      item.confirmedBytes = 0;
      item.transferredBytes = 0;
      item.loadedBytes = 0;
      refreshFileList();
      try {
        // Observe late initialization responses so cancelled sessions can be cleaned up.
        const data = await initUpload({
          filename: item.file.name,
          ...(getUploadPath(item.file) !== item.file.name
            ? { relative_path: getUploadPath(item.file) } : {}),
          total_size: item.file.size,
        });
        const session = {
          sessionId: data.session_id,
          totalChunks: data.total_chunks,
          chunkSize: data.chunk_size || CHUNK_SIZE,
          totalSize: item.file.size,
          receivedChunks: 0,
          finalFilename: data.final_filename,
        };
        item.session = session;
        item.savedFilename = data.final_filename;
        checkActive();
        if (
          !session.sessionId ||
          !Number.isInteger(session.totalChunks) ||
          session.totalChunks < 0 ||
          !Number.isFinite(session.chunkSize) ||
          session.chunkSize <= 0 ||
          session.totalChunks !== Math.ceil(item.file.size / session.chunkSize)
        ) {
          throw new Error("服务端返回的分块配置无效");
        }
        // Shared only by the workers for this file's current upload attempt.
        const transfer = {
          nextChunkIndex: 0,
          lastPaint: 0,
          failure: undefined as unknown,
        };
        const worker = async () => {
          try {
            while (transfer.nextChunkIndex < session.totalChunks) {
              await waitForResume();
              checkActive();
              if (transfer.nextChunkIndex >= session.totalChunks) return;
              const index = transfer.nextChunkIndex++;
              const chunk = item.file.slice(
                index * session.chunkSize,
                Math.min((index + 1) * session.chunkSize, item.file.size),
              );
              const attempt = { loaded: 0 };
              const recordTransferred = (loaded: number) => {
                item.transferredBytes += Math.max(0, loaded - attempt.loaded);
                attempt.loaded = Math.max(attempt.loaded, loaded);
              };
              const send = () =>
                uploadChunk({
                  sessionId: session.sessionId,
                  chunkIndex: index,
                  chunk,
                  transport: data.upload_transport,
                  signal: controller.abort.signal,
                  onProgress: (loaded, total) => {
                    if (isStopped() || controller.abort.signal.aborted) return;
                    const bytes = Math.min(
                      chunk.size,
                      Math.max(
                        0,
                        total > 0 ? (loaded / total) * chunk.size : loaded,
                      ),
                    );
                    recordTransferred(bytes);
                    item.inflightBytes.set(index, bytes);
                    if (Date.now() - transfer.lastPaint >= PROGRESS_REFRESH_INTERVAL) {
                      transfer.lastPaint = Date.now();
                      recalcLoadedBytes(item);
                      refreshFileList();
                    }
                  },
                });
              for (let retry = 0; ; retry++) {
                try {
                  await send();
                  break;
                } catch (err) {
                  if (isStopped() || isCanceledError(err) || controller.abort.signal.aborted) throw err;
                  const delay = uploadRetryDelay(err, retry);
                  if (delay === null) throw err;
                  item.inflightBytes.delete(index);
                  attempt.loaded = 0;
                  await waitForRetry(delay, controller.abort.signal);
                  await waitForResume();
                }
              }
              checkActive();
              if (controller.abort.signal.aborted) return;
              recordTransferred(chunk.size);
              item.inflightBytes.delete(index);
              confirmChunk(item, index, chunk.size);
              session.receivedChunks = item.confirmedChunks.size;
              recalcLoadedBytes(item);
              refreshFileList();
            }
          } catch (err) {
            if (transfer.failure === undefined) transfer.failure = err;
            controller.abort.abort();
            throw err;
          }
        };
        // A file slot is released only after every worker has stopped.
        await Promise.allSettled(
          Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker),
        );
        if (transfer.failure !== undefined) throw transfer.failure;
        checkActive();
        await waitForResume();
        item.state = "completing";
        item.speed = 0;
        refreshFileList();
        const complete = await completeUpload(
          session.sessionId,
          controller.abort.signal,
        );
        checkActive();
        item.state = "success";
        item.savedFilename = complete.saved_filename || item.savedFilename;
        item.inflightBytes.clear();
        recalcLoadedBytes(item);
      } catch (err) {
        clock.pause();
        await cleanupSession(item);
        item.session = null;
        item.inflightBytes.clear();
        item.loadedBytes = 0;
        if (isStopped()) item.state = "pending";
        else {
          item.state = "error";
          const body = getErrorBody<{
            error?: string;
            missing_chunks?: number[];
          }>(err);
          const failure = body?.missing_chunks
            ? message('upload.missingChunks', { count: body.missing_chunks.length })
            : apiErrorDescriptor(err);
          item.error = failure;
          if (mountedRef.current)
            setStatus({
              text: message('upload.failed', { name: item.file.name, error: failure }),
              type: "error",
            });
        }
      } finally {
        clock.pause();
        item.speed = 0;
        item.uploadController = null;
        refreshFileList();
      }
    },
    [refreshFileList, waitForChange],
  );
  const startUploads = useCallback(
    async (fileKey?: string) => {
      if (runRef.current) return;
      const pending = itemsRef.current.filter(
        (i) =>
          (i.state === "pending" || i.state === "error") &&
          (fileKey === undefined || getFileKey(i.file) === fileKey),
      );
      if (!pending.length) return;
      const run = { cancelled: false, nextFileIndex: 0 };
      queueClockRef.current = createElapsedClock();
      queueClockRef.current.resume();
      setQueueElapsedMs(0);
      runRef.current = run;
      setRunning(true);
      setGlobalPaused(false);
      setStatus(null);
      const worker = async () => {
        while (!run.cancelled && mountedRef.current && run.nextFileIndex < pending.length) {
          if (globalPausedRef.current) {
            await waitForChange();
            continue;
          }
          const item = pending[run.nextFileIndex++];
          if (!itemsRef.current.includes(item)) continue;
          await uploadFileChunked(item, run);
        }
      };
      try {
        await Promise.allSettled(
          Array.from({ length: MAX_CONCURRENT_FILES }, worker),
        );
      } finally {
        queueClockRef.current?.pause();
        refreshFileList();
        if (runRef.current === run) runRef.current = null;
        if (mountedRef.current) {
          setRunning(false);
          setCanceling(false);
        }
        if (mountedRef.current && run.cancelled)
          setStatus({ text: message('upload.canceled'), type: "success" });
      }
    },
    [uploadFileChunked, setGlobalPaused, refreshFileList, waitForChange],
  );
  const pauseAll = () => {
    queueClockRef.current?.pause();
    setGlobalPaused(true);
    itemsRef.current.forEach((i) => {
      if (i.uploadController) {
        clocksRef.current.get(i)?.pause();
        i.uploadController.paused = true;
        i.speed = 0;
      }
    });
    refreshFileList();
  };
  const resumeAll = () => {
    if (runRef.current && !runRef.current.cancelled) queueClockRef.current?.resume();
    setGlobalPaused(false);
    itemsRef.current.forEach((i) => {
      if (i.uploadController) {
        i.uploadController.paused = false;
        if (!i.uploadController.cancelled) clocksRef.current.get(i)?.resume();
      }
    });
    refreshFileList();
  };
  const cancelAll = () => {
    queueClockRef.current?.pause();
    setCanceling(true);
    if (runRef.current) runRef.current.cancelled = true;
    itemsRef.current.forEach((item) => {
      clocksRef.current.get(item)?.pause();
      stopItem(item);
      if (item.uploadController) {
        item.state = "canceling";
        item.speed = 0;
      }
    });
    setGlobalPaused(false);
    setStatus({ text: message('upload.canceling'), type: "success" });
    refreshFileList();
  };
  const resetAll = () => {
    if (runRef.current) return;
    itemsRef.current = [];
    queueClockRef.current = null;
    setQueueElapsedMs(null);
    setGlobalPaused(false);
    setStatus(null);
    refreshFileList();
  };
  const removeItem = useCallback(
    (fileKey: string) => {
      const index = itemsRef.current.findIndex(
        (item) => getFileKey(item.file) === fileKey,
      );
      const item = itemsRef.current[index];
      if (!item) return;
      clocksRef.current.get(item)?.pause();
      stopItem(item);
      itemsRef.current.splice(index, 1);
      refreshFileList();
    },
    [refreshFileList],
  );
  const retryItem = useCallback(
    (fileKey: string) => startUploads(fileKey),
    [startUploads],
  );
  const pendingCount = items.filter((i) => i.state === "pending").length;
  const uploadingCount = items.filter((i) => i.state === "uploading").length;
  const pausedCount = items.filter((i) => i.state === "paused").length;
  const successCount = items.filter((i) => i.state === "success").length;
  const errorCount = items.filter((i) => i.state === "error").length;
  const totalSpeed = globalPaused
    ? 0
    : items
        .filter((i) => i.state === "uploading")
        .reduce((sum, i) => sum + i.speed, 0);
  return {
    items,
    globalPaused,
    running,
    canceling,
    dragOver,
    setDragOver,
    status,
    totalSpeed,
    queueElapsedMs,
    pendingCount,
    uploadingCount,
    pausedCount,
    successCount,
    errorCount,
    activeCount: running ? Math.max(1, uploadingCount + pausedCount) : 0,
    hasUploading,
    fileInputRef,
    startAllUploads: () => startUploads(),
    retryItem,
    pauseAll,
    resumeAll,
    cancelAll,
    resetAll,
    removeItem,
    handleSelection,
    handleDrop,
    readingFolders: readingDrops > 0,
    openFilePicker: () => fileInputRef.current?.click(),
  };
};
