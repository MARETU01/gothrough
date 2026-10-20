import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelUpload, completeUpload, getErrorBody, initUpload, isCanceledError, uploadChunk } from '@/services/upload';
import type { UploadController, UploadItem, StatusMessage } from '@/types/upload';
import { CHUNK_SIZE, MAX_CONCURRENT_FILES, MAX_CONCURRENT_UPLOADS, PROGRESS_REFRESH_INTERVAL } from '@/config/upload';
import { getFileKey, recalcLoadedBytes } from '@/utils/upload';
import { errorMessage, sleep } from '@/utils/misc';

export const useUploadQueue = () => {
  const itemsRef = useRef<UploadItem[]>([]);
  const globalPausedRef = useRef(false);
  const mountedRef = useRef(true);
  const runRef = useRef<{ cancelled: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [globalPaused, setGlobalPausedState] = useState(false);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const refreshFileList = useCallback(() => {
    if (mountedRef.current) setItems([...itemsRef.current]);
  }, []);
  const setGlobalPaused = (paused: boolean) => {
    globalPausedRef.current = paused;
    if (mountedRef.current) setGlobalPausedState(paused);
  };
  const cleanupSession = async (item: UploadItem) => {
    if (!item.session) return;
    try { await cancelUpload(item.session.sessionId); } catch { /* Server must expire abandoned sessions too. */ }
  };
  const stopItem = (item: UploadItem) => {
    if (item.uploadController) {
      item.uploadController.cancelled = true;
      item.uploadController.abort.abort();
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (runRef.current) runRef.current.cancelled = true;
      itemsRef.current.forEach(stopItem);
    };
  }, []);
  const hasUploading = items.some((i) => i.state === 'uploading');
  useEffect(() => {
    const samples = new WeakMap<UploadItem, { bytes: number; time: number }>();
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      itemsRef.current.forEach((item) => {
        const previous = samples.get(item) ?? { bytes: 0, time: now - 500 };
        const speed = item.state === 'uploading' && !globalPausedRef.current
          ? Math.max(0, item.transferredBytes - previous.bytes) * 1000 / Math.max(1, now - previous.time) : 0;
        samples.set(item, { bytes: item.transferredBytes, time: now });
        if (item.speed !== speed) { item.speed = speed; changed = true; }
      });
      if (changed) refreshFileList();
    }, 500);
    return () => clearInterval(timer);
  }, [refreshFileList]);
  const handleSelection = (files: FileList) => {
    const keys = new Set(itemsRef.current.map((i) => getFileKey(i.file)));
    Array.from(files).forEach((file) => {
      const key = getFileKey(file);
      if (keys.has(key)) return;
      itemsRef.current.push({ file, state: 'pending', session: null, speed: 0, savedFilename: '', uploadController: null, inflightBytes: new Map(), confirmedBytes: new Map(), transferredBytes: 0, loadedBytes: 0 });
      keys.add(key);
    });
    refreshFileList();
    setStatus(null);
  };
  const uploadFileChunked = async (item: UploadItem, run: { cancelled: boolean }) => {
    const controller: UploadController = { paused: false, cancelled: false, abort: new AbortController() };
    item.uploadController = controller;
    const isStopped = () => run.cancelled || controller.cancelled || !mountedRef.current || !itemsRef.current.includes(item);
    const checkActive = () => { if (isStopped() || controller.abort.signal.aborted) throw new Error('Upload cancelled'); };
    const waitForResume = async () => {
      checkActive();
      while (globalPausedRef.current || controller.paused) {
        item.state = 'paused'; item.speed = 0; refreshFileList();
        await sleep(100); checkActive();
      }
      item.state = 'uploading'; refreshFileList();
    };
    item.state = 'uploading'; item.speed = 0; item.session = null;
    item.inflightBytes.clear(); item.confirmedBytes.clear(); item.transferredBytes = 0; item.loadedBytes = 0; refreshFileList();
    try {
      // Observe late initialization responses so cancelled sessions can be cleaned up.
      const data = await initUpload({ filename: item.file.name, total_size: item.file.size });
      const session = { sessionId: data.session_id, totalChunks: data.total_chunks, chunkSize: data.chunk_size || CHUNK_SIZE, totalSize: item.file.size, receivedChunks: 0, finalFilename: data.final_filename };
      item.session = session; item.savedFilename = data.final_filename; checkActive();
      let chunkIndex = 0;
      let lastPaint = 0;
      let failure: unknown;
      const worker = async () => {
        try {
          while (chunkIndex < session.totalChunks) {
            await waitForResume(); checkActive();
            if (chunkIndex >= session.totalChunks) return;
            const index = chunkIndex++;
            const chunk = item.file.slice(index * session.chunkSize, Math.min((index + 1) * session.chunkSize, item.file.size));
            let attemptLoaded = 0;
            const recordTransferred = (loaded: number) => {
              item.transferredBytes += Math.max(0, loaded - attemptLoaded);
              attemptLoaded = Math.max(attemptLoaded, loaded);
            };
            const send = () => uploadChunk({ sessionId: session.sessionId, chunkIndex: index, chunk, signal: controller.abort.signal, onProgress: (loaded, total) => {
              if (isStopped() || controller.abort.signal.aborted) return;
              const bytes = Math.min(chunk.size, Math.max(0, total > 0 ? loaded / total * chunk.size : loaded));
              recordTransferred(bytes);
              item.inflightBytes.set(index, bytes); recalcLoadedBytes(item);
              if (Date.now() - lastPaint >= PROGRESS_REFRESH_INTERVAL) { lastPaint = Date.now(); refreshFileList(); }
            } });
            try { await send(); } catch (err) {
              if (isStopped() || isCanceledError(err) || controller.abort.signal.aborted) throw err;
              item.inflightBytes.delete(index); attemptLoaded = 0; await waitForResume(); await send();
            }
            checkActive();
            if (controller.abort.signal.aborted) return;
            recordTransferred(chunk.size);
            item.inflightBytes.delete(index);
            item.confirmedBytes.set(index, chunk.size);
            session.receivedChunks = item.confirmedBytes.size;
            recalcLoadedBytes(item); refreshFileList();
          }
        } catch (err) {
          if (failure === undefined) failure = err;
          controller.abort.abort(); throw err;
        }
      };
      // A file slot is released only after every worker has stopped.
      await Promise.allSettled(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker));
      if (failure !== undefined) throw failure;
      checkActive(); await waitForResume();
      const complete = await completeUpload(session.sessionId, controller.abort.signal);
      checkActive(); item.state = 'success';
      item.savedFilename = complete.saved_filename || item.savedFilename;
      item.inflightBytes.clear(); recalcLoadedBytes(item);
    } catch (err) {
      await cleanupSession(item);
      item.session = null; item.inflightBytes.clear(); item.loadedBytes = 0;
      if (isStopped()) item.state = 'pending';
      else {
        item.state = 'error';
        const body = getErrorBody<{ error?: string; missing_chunks?: number[] }>(err);
        const message = body?.missing_chunks ? `缺少 ${body.missing_chunks.length} 个分块` : body?.error ?? errorMessage(err);
        if (mountedRef.current) setStatus({ text: `上传失败: ${item.file.name} - ${message}`, type: 'error' });
      }
    } finally { item.speed = 0; item.uploadController = null; refreshFileList(); }
  };
  const startAllUploads = async () => {
    if (runRef.current) return;
    const pending = itemsRef.current.filter((i) => i.state === 'pending' || i.state === 'error');
    if (!pending.length) return;
    const run = { cancelled: false }; runRef.current = run;
    setRunning(true); setGlobalPaused(false); setStatus(null);
    let next = 0;
    const worker = async () => {
      while (!run.cancelled && mountedRef.current && next < pending.length) {
        if (globalPausedRef.current) { await sleep(100); continue; }
        const item = pending[next++];
        if (!itemsRef.current.includes(item)) continue;
        await uploadFileChunked(item, run);
      }
    };
    try { await Promise.allSettled(Array.from({ length: MAX_CONCURRENT_FILES }, worker)); }
    finally {
      if (runRef.current === run) runRef.current = null;
      if (mountedRef.current) setRunning(false);
    }
  };
  const pauseAll = () => {
    setGlobalPaused(true);
    itemsRef.current.forEach((i) => { if (i.uploadController) { i.uploadController.paused = true; i.speed = 0; } });
    refreshFileList();
  };
  const resumeAll = () => {
    setGlobalPaused(false);
    itemsRef.current.forEach((i) => { if (i.uploadController) i.uploadController.paused = false; });
    refreshFileList();
  };
  const cancelAll = () => {
    if (runRef.current) runRef.current.cancelled = true;
    itemsRef.current.forEach(stopItem); setGlobalPaused(false);
    setStatus({ text: '已取消队列，正在结束当前请求', type: 'success' }); refreshFileList();
  };
  const resetAll = () => {
    if (runRef.current) return;
    itemsRef.current = []; setGlobalPaused(false); setStatus(null); refreshFileList();
  };
  const removeItem = (index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;
    stopItem(item); itemsRef.current.splice(index, 1); refreshFileList();
  };
  const pendingCount = items.filter((i) => i.state === 'pending').length;
  const uploadingCount = items.filter((i) => i.state === 'uploading').length;
  const pausedCount = items.filter((i) => i.state === 'paused').length;
  const successCount = items.filter((i) => i.state === 'success').length;
  const errorCount = items.filter((i) => i.state === 'error').length;
  const totalSpeed = globalPaused ? 0 : items.filter((i) => i.state === 'uploading').reduce((sum, i) => sum + i.speed, 0);
  return { items, globalPaused, running, dragOver, setDragOver, status, totalSpeed, pendingCount, uploadingCount, pausedCount, successCount, errorCount, activeCount: running ? Math.max(1, uploadingCount + pausedCount) : 0, hasUploading, fileInputRef, startAllUploads, pauseAll, resumeAll, cancelAll, resetAll, removeItem, handleSelection, openFilePicker: () => fileInputRef.current?.click() };
};
