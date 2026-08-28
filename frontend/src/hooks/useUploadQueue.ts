import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelUpload,
  completeUpload,
  getErrorBody,
  initUpload,
  isCanceledError,
  uploadChunk,
  type CompleteUploadResponse,
  type InitUploadResponse,
  type UploadChunkResponse,
} from '@/services/upload';
import {
  type StatusMessage,
  type UploadController,
  type UploadItem,
  type UploadSession,
} from '@/types/upload';
import {
  CHUNK_SIZE,
  MAX_CONCURRENT_FILES,
  MAX_CONCURRENT_UPLOADS,
  PROGRESS_REFRESH_INTERVAL,
} from '@/config/upload';
import { getFileKey, recalcLoadedBytes } from '@/utils/upload';
import { errorMessage, sleep } from '@/utils/misc';

/**
 * 分块上传队列 hook：封装文件选择、并发分块上传、暂停 / 恢复 / 取消、
 * 速度与进度计算等全部逻辑。页面组件只需消费返回值做渲染。
 */
export const useUploadQueue = () => {
  // 上传队列：异步 worker 直接修改 itemsRef 中的元素，
  // 修改后调用 refreshFileList() 把队列快照同步到 state 触发重绘
  const itemsRef = useRef<UploadItem[]>([]);
  const globalPausedRef = useRef(false); // worker 循环内实时读取
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [globalPaused, setGlobalPausedState] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [totalSpeed, setTotalSpeed] = useState(0);

  const refreshFileList = useCallback(() => setItems([...itemsRef.current]), []);

  const setGlobalPaused = useCallback((paused: boolean) => {
    globalPausedRef.current = paused;
    setGlobalPausedState(paused);
  }, []);

  const showStatus = useCallback((message: string, type: 'success' | 'error') => {
    setStatus({ text: message, type });
  }, []);

  const pendingCount = items.filter((i) => i.state === 'pending').length;
  const uploadingCount = items.filter((i) => i.state === 'uploading').length;
  const pausedCount = items.filter((i) => i.state === 'paused').length;
  const successCount = items.filter((i) => i.state === 'success').length;
  const errorCount = items.filter((i) => i.state === 'error').length;
  const activeCount = uploadingCount + pausedCount;
  const hasUploading = uploadingCount > 0;

  /* ==================== 总速度自动刷新（500ms） ==================== */
  useEffect(() => {
    if (!hasUploading) return;
    const timer = setInterval(() => {
      const speed = itemsRef.current
        .filter((i) => i.state === 'uploading')
        .reduce((sum, i) => sum + i.speed, 0);
      setTotalSpeed(speed);
    }, 500);
    return () => clearInterval(timer);
  }, [hasUploading]);

  /* ==================== 文件选择 ==================== */
  const handleSelection = (fileListObj: FileList) => {
    const existingKeys = new Set(itemsRef.current.map((i) => getFileKey(i.file)));
    Array.from(fileListObj).forEach((file) => {
      const key = getFileKey(file);
      if (existingKeys.has(key)) return;
      itemsRef.current.push({
        file,
        state: 'pending',
        session: null,
        speed: 0,
        savedFilename: '',
        uploadController: null,
        inflightBytes: new Map(),
        loadedBytes: 0,
      });
      existingKeys.add(key);
    });
    refreshFileList();
    setStatus(null);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  /* ==================== 分块上传核心逻辑 ==================== */
  const uploadFileChunked = async (item: UploadItem) => {
    const file = item.file;
    item.state = 'uploading';
    item.speed = 0;
    item.inflightBytes.clear();
    item.loadedBytes = 0;
    refreshFileList();

    try {
      // Step 1: 初始化会话 —— POST /api/upload/init，body: { filename, total_size }
      let sessionData: InitUploadResponse;
      try {
        sessionData = await initUpload({ filename: file.name, total_size: file.size });
      } catch (err) {
        const body = getErrorBody<InitUploadResponse>(err);
        item.state = 'error';
        refreshFileList();
        showStatus(`初始化失败: ${body?.error ?? errorMessage(err)}`, 'error');
        return;
      }

      const session: UploadSession = {
        sessionId: sessionData.session_id,
        totalChunks: sessionData.total_chunks,
        chunkSize: sessionData.chunk_size || CHUNK_SIZE,
        totalSize: file.size,
        receivedChunks: 0,
        finalFilename: sessionData.final_filename,
      };
      item.session = session;
      item.savedFilename = sessionData.final_filename;
      recalcLoadedBytes(item);
      refreshFileList();

      // Step 2: 并发上传分块（带暂停 / 取消控制）
      const uploadController: UploadController = {
        paused: false,
        cancelled: false,
        abort: new AbortController(),
      };
      item.uploadController = uploadController;

      let chunkIndex = 0;
      const speedSamples: number[] = [];
      let lastPaint = 0;

      const uploadNextChunk = async () => {
        while (chunkIndex < session.totalChunks) {
          // 检查暂停 / 取消
          if (uploadController.cancelled) throw new Error('Upload cancelled');
          while (uploadController.paused || globalPausedRef.current) {
            item.state = 'paused';
            refreshFileList();
            await sleep(300);
            if (uploadController.cancelled) throw new Error('Upload cancelled');
          }
          item.state = 'uploading';

          const ci = chunkIndex++;
          const start = ci * session.chunkSize;
          const end = Math.min(start + session.chunkSize, file.size);
          const blob = file.slice(start, end);
          const chunkBytes = end - start;

          // multipart 字段与原页面一致：session_id / chunk_index / chunk
          const sendChunk = () =>
            uploadChunk({
              sessionId: session.sessionId,
              chunkIndex: ci,
              chunk: blob,
              signal: uploadController.abort.signal,
              // axios 上传进度：本分块已发送字节，实时累加到文件级进度（节流重绘）
              onProgress: (loaded) => {
                if (uploadController.cancelled) return;
                item.inflightBytes.set(ci, Math.min(loaded, chunkBytes));
                recalcLoadedBytes(item);
                const now = Date.now();
                if (now - lastPaint >= PROGRESS_REFRESH_INTERVAL) {
                  lastPaint = now;
                  refreshFileList();
                }
              },
            });

          const startTime = Date.now();

          let chunkResult: UploadChunkResponse;
          try {
            chunkResult = await sendChunk();
          } catch (err) {
            if (isCanceledError(err) || uploadController.cancelled) throw new Error('Upload cancelled');
            try {
              // 失败时重试一次
              chunkResult = await sendChunk();
            } catch (retryErr) {
              if (isCanceledError(retryErr) || uploadController.cancelled) {
                throw new Error('Upload cancelled');
              }
              throw new Error(`Chunk ${ci} upload failed`);
            }
          }

          item.inflightBytes.delete(ci);
          session.receivedChunks = chunkResult.received;

          // 速度计算
          const elapsed = Date.now() - startTime;
          if (elapsed > 0) {
            const chunkSpeed = chunkBytes / (elapsed / 1000);
            speedSamples.push(chunkSpeed);
            if (speedSamples.length > 10) speedSamples.shift();
            item.speed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
          }

          recalcLoadedBytes(item);
          refreshFileList();
        }
      };

      // 并发执行
      const workers: Promise<void>[] = [];
      for (let w = 0; w < MAX_CONCURRENT_UPLOADS; w++) {
        workers.push(uploadNextChunk());
      }
      await Promise.all(workers);

      // Step 3: 完成上传 —— POST /api/upload/complete，body: { session_id }
      let completeData: CompleteUploadResponse;
      try {
        completeData = await completeUpload(session.sessionId);
      } catch (err) {
        const errData = getErrorBody<CompleteUploadResponse>(err);
        // 分块缺失时可以重试
        if (errData?.missing_chunks) {
          item.state = 'error';
          refreshFileList();
          showStatus(`部分分块缺失，请重试: ${errData.missing_chunks.length} 个分块`, 'error');
          return;
        }
        throw new Error(errData?.error ?? 'Complete failed');
      }

      item.state = 'success';
      item.speed = 0;
      item.savedFilename = completeData.saved_filename || item.savedFilename;
      item.inflightBytes.clear();
      recalcLoadedBytes(item);
      refreshFileList();
    } catch (err) {
      if (errorMessage(err) === 'Upload cancelled') {
        // 已由取消逻辑处理
      } else {
        item.state = 'error';
        item.speed = 0;
        refreshFileList();
        showStatus(`上传失败: ${file.name} - ${errorMessage(err)}`, 'error');
      }
    }
  };

  const startAllUploads = async () => {
    const toUpload = itemsRef.current.filter((i) => i.state === 'pending' || i.state === 'error');
    if (!toUpload.length) return;
    setGlobalPaused(false);
    setStatus(null);
    // 分批并发上传文件
    for (let i = 0; i < toUpload.length; i += MAX_CONCURRENT_FILES) {
      const batch = toUpload.slice(i, i + MAX_CONCURRENT_FILES);
      await Promise.all(batch.map((uploadItem) => uploadFileChunked(uploadItem)));
    }
  };

  /* ==================== 暂停 / 恢复 / 取消 ==================== */
  const pauseAll = () => {
    setGlobalPaused(true);
    itemsRef.current.forEach((i) => {
      if (i.state === 'uploading' && i.uploadController) {
        i.uploadController.paused = true;
      }
    });
    refreshFileList();
  };

  const resumeAll = () => {
    setGlobalPaused(false);
    itemsRef.current.forEach((i) => {
      if (i.state === 'paused' && i.uploadController) {
        i.uploadController.paused = false;
      }
    });
    refreshFileList();
  };

  const cancelAll = async () => {
    const activeItems = itemsRef.current.filter((i) => i.state === 'uploading' || i.state === 'paused');
    for (const item of activeItems) {
      if (item.uploadController) {
        item.uploadController.cancelled = true;
        // axios signal：立刻中断进行中的分块请求，而不是等它传完
        item.uploadController.abort.abort();
      }
      if (item.session) {
        try {
          await cancelUpload(item.session.sessionId);
        } catch {
          /* ignore */
        }
      }
      item.state = 'pending';
      item.session = null;
      item.uploadController = null;
      item.speed = 0;
      item.inflightBytes.clear();
      item.loadedBytes = 0;
    }
    setGlobalPaused(false);
    refreshFileList();
    showStatus('所有上传已取消', 'error');
  };

  const resetAll = () => {
    itemsRef.current = [];
    setGlobalPaused(false);
    setStatus(null);
    refreshFileList();
  };

  /* ==================== 移除单个文件 ==================== */
  const removeItem = (index: number) => {
    const item = itemsRef.current[index];
    if (!item) return;
    if (item.uploadController) {
      item.uploadController.cancelled = true;
      item.uploadController.abort.abort();
    }
    itemsRef.current.splice(index, 1);
    refreshFileList();
  };

  return {
    items,
    globalPaused,
    dragOver,
    setDragOver,
    status,
    totalSpeed,
    pendingCount,
    uploadingCount,
    pausedCount,
    successCount,
    errorCount,
    activeCount,
    hasUploading,
    fileInputRef,
    startAllUploads,
    pauseAll,
    resumeAll,
    cancelAll,
    resetAll,
    removeItem,
    handleSelection,
    openFilePicker,
  };
};
