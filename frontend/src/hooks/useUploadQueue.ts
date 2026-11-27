import { message } from '@/i18n/messages';
import { useCallback, useEffect, useRef, useState } from "react";
import { UploadTask } from '@/features/upload/task';
import { cleanupSession, stopItem, suspendItemForAuth, transferFile, UploadMissingChunksError } from '@/features/upload/engine';
import { apiErrorDescriptor, getErrorBody } from "@/services/errors";
import type {
  UploadController,
  UploadViewItem,
  StatusMessage,
} from "@/types/upload";
import { MAX_CONCURRENT_FILES } from '@/config/upload';
import {
  createUploadSnapshot,
  getFileKey,
} from "@/utils/upload";
import { errorMessage } from "@/utils/misc";
import { createElapsedClock } from "@/utils/elapsed";
import { collectDroppedFiles } from "@/utils/droppedFiles";

export const useUploadQueue = () => {
  const itemsRef = useRef<UploadTask[]>([]);
  const globalPausedRef = useRef(false);
  const authPaused = useRef(false);
  const mountedRef = useRef(true);
  const runRef = useRef<{ cancelled: boolean; discarded: boolean } | null>(null);
  const queueGeneration = useRef(0);
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
  const snapshotsRef = useRef(new WeakMap<UploadTask, UploadViewItem>());
  const clocksRef = useRef(new WeakMap<UploadTask, ReturnType<typeof createElapsedClock>>());
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
      if (clock) item.sampleElapsed(clock.read());
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
  const suspendForAuth = useCallback(() => {
    if (authPaused.current) return;
    authPaused.current = true;
    queueClockRef.current?.pause();
    for (const item of itemsRef.current) {
      clocksRef.current.get(item)?.pause();
      suspendItemForAuth(item);
    }
  }, []);
  const resumeAfterAuth = useCallback(() => {
    if (!authPaused.current) return;
    authPaused.current = false;
    if (runRef.current && !runRef.current.cancelled && !globalPausedRef.current) queueClockRef.current?.resume();
    wakeWorkers();
  }, [wakeWorkers]);
  const discardForLogout = useCallback(() => {
    queueGeneration.current++;
    if (runRef.current) {
      runRef.current.cancelled = true;
      runRef.current.discarded = true;
    }
    itemsRef.current.forEach(stopItem);
    itemsRef.current = [];
    queueClockRef.current = null;
    authPaused.current = false;
    setQueueElapsedMs(null);
    setGlobalPaused(false);
    setDragOver(false);
    setReadingDrops(0);
    setStatus(null);
    refreshFileList();
  }, [refreshFileList, setGlobalPaused]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (runRef.current) runRef.current.cancelled = true;
      itemsRef.current.forEach(stopItem);
      wakeWorkers();
    };
  }, [wakeWorkers]);
  let pendingCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let totalSpeed = 0;
  for (const item of items) {
    if (item.state === "pending") pendingCount++;
    else if (item.state === "success") successCount++;
    else if (item.state === "error") errorCount++;
    else if (item.state === "uploading" && !globalPaused) totalSpeed += item.speed;
  }
  const hasUnfinished = running || successCount !== items.length;
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
    const samples = new WeakMap<UploadTask, { bytes: number; time: number }>();
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
          item.sampleSpeed(speed);
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
      itemsRef.current.push(new UploadTask(file, refreshFileList));
      keys.add(key);
    });
    refreshFileList();
    setStatus(null);
  };
  const handleDrop = async (data: DataTransfer) => {
    const generation = queueGeneration.current;
    setReadingDrops(count => count + 1);
    setStatus(null);
    try {
      const files = await collectDroppedFiles(data);
      if (!mountedRef.current || queueGeneration.current !== generation) return;
      handleSelection(files);
      if (!files.length) setStatus({ text: message("upload.emptyFolder"), type: "error" });
    } catch (err) {
      if (mountedRef.current && queueGeneration.current === generation)
        setStatus({ text: message('upload.readFolderFailed', { error: errorMessage(err) }), type: "error" });
    } finally {
      if (mountedRef.current && queueGeneration.current === generation) setReadingDrops(count => count - 1);
    }
  };
  const uploadFileChunked = useCallback(
    async (item: UploadTask, run: { cancelled: boolean }) => {
      const resuming = item.session !== null;
      const controller: UploadController = {
        cancelled: false,
        abort: new AbortController(),
      };
      item.attachController(controller);
      const clock = createElapsedClock();
      clocksRef.current.set(item, clock);
      clock.resume();
      const isStopped = () =>
        run.cancelled ||
        controller.cancelled ||
        !mountedRef.current ||
        !itemsRef.current.includes(item);
      try {
        await transferFile(item, controller, {
          isStopped,
          isPaused: () => globalPausedRef.current,
          waitForChange,
        });
      } catch (err) {
        clock.pause();
        const body = getErrorBody<{ code?: string }>(err);
        const keepSession = !isStopped() && (err instanceof UploadMissingChunksError ||
          (resuming && body?.code !== 'INVALID_SESSION'));
        const interruptedByAuth = () => controller.authInterrupted && !isStopped();
        if (!interruptedByAuth() && !item.completionPending && !keepSession) {
          await cleanupSession(item);
        }
        if (interruptedByAuth()) {
          item.suspend();
          return true;
        }
        if (isStopped()) item.interrupt();
        else {
          const failure = err instanceof UploadMissingChunksError ? message('upload.missingChunks', { count: err.count })
            : item.completionPending ? message('upload.confirmationPending') : apiErrorDescriptor(err);
          item.fail(failure, keepSession);
          if (mountedRef.current)
            setStatus({
              text: message('upload.failed', { name: item.file.name, error: failure }),
              type: "error",
            });
        }
      } finally {
        clock.pause();
        item.endAttempt();
      }
      return false;
    },
    [waitForChange],
  );
  const startUploads = useCallback(
    async (fileKey?: string) => {
      if (runRef.current || authPaused.current) return;
      const pending = itemsRef.current.filter(
        (i) =>
          (i.state === "pending" || i.state === "error") &&
          (fileKey === undefined || getFileKey(i.file) === fileKey),
      );
      if (!pending.length) return;
      const run = { cancelled: false, discarded: false, nextFileIndex: 0 };
      queueClockRef.current = createElapsedClock();
      queueClockRef.current.resume();
      setQueueElapsedMs(0);
      runRef.current = run;
      setRunning(true);
      setGlobalPaused(false);
      setStatus(null);
      const worker = async () => {
        while (!run.cancelled && mountedRef.current && run.nextFileIndex < pending.length) {
          const item = pending[run.nextFileIndex++];
          while (!run.cancelled && mountedRef.current && itemsRef.current.includes(item)) {
            if (authPaused.current || globalPausedRef.current) {
              await waitForChange();
              continue;
            }
            if (!await uploadFileChunked(item, run)) break;
          }
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
        if (mountedRef.current && run.cancelled && !run.discarded)
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
        i.sampleSpeed(0);
      }
    });
    refreshFileList();
  };
  const resumeAll = () => {
    if (runRef.current && !runRef.current.cancelled) queueClockRef.current?.resume();
    setGlobalPaused(false);
    itemsRef.current.forEach((i) => {
      if (i.uploadController) {
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
        item.markCanceling();
      } else if (item.session && !item.completionPending && item.state !== 'success') {
        void cleanupSession(item);
        item.interrupt();
      }
    });
    setGlobalPaused(false);
    setStatus({ text: message('upload.canceling'), type: "success" });
    refreshFileList();
  };
  const resetAll = () => {
    if (runRef.current) return;
    itemsRef.current.forEach(item => { if (item.state !== 'success') void cleanupSession(item); });
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
      if (item.session && item.state !== 'success' && !item.uploadController) void cleanupSession(item);
      wakeWorkers();
      refreshFileList();
    },
    [refreshFileList, wakeWorkers],
  );
  const retryItem = useCallback(
    (fileKey: string) => startUploads(fileKey),
    [startUploads],
  );
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
    successCount,
    errorCount,
    fileInputRef,
    startAllUploads: () => startUploads(),
    retryItem,
    pauseAll,
    resumeAll,
    cancelAll,
    resetAll,
    removeItem,
    suspendForAuth,
    resumeAfterAuth,
    discardForLogout,
    handleSelection,
    handleDrop,
    readingFolders: readingDrops > 0,
    openFilePicker: () => fileInputRef.current?.click(),
  };
};
