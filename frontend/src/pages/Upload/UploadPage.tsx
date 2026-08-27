import React, { useCallback, useEffect, useRef, useState } from 'react';
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
} from '../../api/upload';
import './UploadPage.css';

/* ==================== 常量（与原 submit.html 保持一致） ==================== */
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB, must match server config（服务端未返回 chunk_size 时的兜底值）
const MAX_CONCURRENT_UPLOADS = 3; // parallel chunk uploads per file
const MAX_CONCURRENT_FILES = 2; // max concurrent file uploads
const PROGRESS_REFRESH_INTERVAL = 100; // axios 上传进度事件的重绘节流（ms）

type UploadState = 'pending' | 'uploading' | 'paused' | 'success' | 'error';

interface UploadSession {
  sessionId: string;
  totalChunks: number;
  chunkSize: number;
  totalSize: number;
  receivedChunks: number;
  finalFilename: string;
}

interface UploadController {
  paused: boolean;
  cancelled: boolean;
  /** 取消时立即中断进行中的 axios 分块请求 */
  abort: AbortController;
}

interface UploadItem {
  file: File;
  state: UploadState;
  session: UploadSession | null;
  speed: number;
  savedFilename: string;
  uploadController: UploadController | null;
  /** 进行中分块的实时已发送字节：chunk_index -> loaded（来自 axios onUploadProgress） */
  inflightBytes: Map<number, number>;
  /** 展示用已发送总字节 = 服务端已确认分块字节 + 进行中分块字节（见 recalcLoadedBytes） */
  loadedBytes: number;
}

interface StatusMessage {
  text: string;
  type: 'success' | 'error';
}

const STATE_LABELS: Record<UploadState, string> = {
  pending: '⏳ 待上传',
  uploading: '📤 上传中',
  paused: '⏸ 已暂停',
  success: '✅ 上传成功',
  error: '❌ 上传失败',
};

/* ==================== 工具函数 ==================== */
const getFileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatSpeed = (bytesPerSec: number) => `${formatSize(bytesPerSec)}/s`;

const formatETA = (remainingBytes: number, bytesPerSec: number) => {
  if (bytesPerSec <= 0) return '--';
  const secs = Math.ceil(remainingBytes / bytesPerSec);
  if (secs < 60) return `${secs}秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分${secs % 60}秒`;
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return `${hrs}时${mins}分`;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 汇总「服务端已确认的分块字节 + 正在传输分块的实时已发送字节」，
 * 结果裁剪到 [0, file.size]，供进度条与剩余时间使用。
 */
const recalcLoadedBytes = (item: UploadItem) => {
  const { session, file } = item;
  if (item.state === 'success') {
    item.loadedBytes = file.size;
    return;
  }
  if (!session) {
    item.loadedBytes = 0;
    return;
  }
  let inflight = 0;
  item.inflightBytes.forEach((bytes) => {
    inflight += bytes;
  });
  const confirmed = Math.min(session.receivedChunks * session.chunkSize, file.size);
  item.loadedBytes = Math.min(file.size, confirmed + inflight);
};

/* ==================== 页面组件 ==================== */
const UploadPage: React.FC = () => {
  // 上传队列：与原脚本的 filesQueue 一致，异步 worker 直接修改 itemsRef 中的元素，
  // 修改后调用 refreshFileList() 把队列快照同步到 state 触发重绘
  // （等价于原来每次分块完成后重建 innerHTML 的做法）。
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

  useEffect(() => {
    document.title = '文件上传 - 分块上传';
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
    const toUpload = itemsRef.current.filter(
      (i) => i.state === 'pending' || i.state === 'error',
    );
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
    const activeItems = itemsRef.current.filter(
      (i) => i.state === 'uploading' || i.state === 'paused',
    );
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

  return (
    <div className="upload-page">
      <div className="container">
        <h1>文件上传</h1>
        <p className="subtitle">支持大文件分块上传，可暂停/恢复，断点续传</p>

        <div className="nav-links">
          <a href="/uploads">📦 查看 / 下载已上传文件</a>
        </div>

        <div
          className={`upload-area${dragOver ? ' dragover' : ''}`}
          onClick={openFilePicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) handleSelection(e.dataTransfer.files);
          }}
        >
          <div className="upload-icon">📁</div>
          <p className="upload-text">拖放文件到此处或点击浏览</p>
          <button
            type="button"
            className="browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
          >
            选择文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            name="files"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (!files || !files.length) return;
              handleSelection(files);
              e.target.value = '';
            }}
          />
        </div>

        <div className="file-list">
          {items.length === 0 ? (
            <div className="empty-hint">没有文件，拖放文件到此处或点击"选择文件"按钮</div>
          ) : (
            items.map((item, index) => {
              const session = item.session;
              // 字节级进度：服务端已确认的分块 + 正在传输分块的实时已发送字节
              const progress = item.file.size
                ? Math.min(100, Math.round((item.loadedBytes / item.file.size) * 100))
                : 0;
              const speedText = item.speed ? formatSpeed(item.speed) : '';
              const etaText =
                session && item.speed > 0
                  ? formatETA(Math.max(0, item.file.size - item.loadedBytes), item.speed)
                  : '';

              return (
                <div key={getFileKey(item.file)} className={`file-row ${item.state}`}>
                  <div className="file-meta">
                    <div className="file-label">
                      <div className="file-name">{item.file.name}</div>
                      <div className="file-size">{formatSize(item.file.size)}</div>
                    </div>
                    <button
                      type="button"
                      className="remove-btn"
                      disabled={item.state === 'uploading'}
                      onClick={() => removeItem(index)}
                    >
                      移除
                    </button>
                  </div>
                  <div className="file-status">
                    <span>{STATE_LABELS[item.state] || ''}</span>
                    {speedText && <span className="speed">{speedText}</span>}
                    {etaText && <span className="eta">剩余 {etaText}</span>}
                    {session && (
                      <span className="chunks">
                        分块 {session.receivedChunks}/{session.totalChunks}
                      </span>
                    )}
                  </div>
                  <div className="progress-bar">
                    <div className="progress" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="progress-text">
                    <span>{progress}%</span>
                    <span>{item.savedFilename || ''}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>


        {status && <div className={`status-message ${status.type}`}>{status.text}</div>}
        <div className="button-container">
          {items.length > 0 &&
            (activeCount > 0 ? (
              <>
                {globalPaused ? (
                  <button type="button" className="resume-btn" onClick={resumeAll}>
                    ▶ 全部恢复
                  </button>
                ) : (
                  <button type="button" className="pause-btn" onClick={pauseAll}>
                    ⏸ 全部暂停
                  </button>
                )}
                <button type="button" className="cancel-btn" onClick={cancelAll}>
                  ✖ 取消全部
                </button>
              </>
            ) : pendingCount > 0 || errorCount > 0 ? (
              <button type="button" className="upload-btn" onClick={startAllUploads}>
                开始上传
              </button>
            ) : successCount > 0 ? (
              <button type="button" className="continue-btn" onClick={resetAll}>
                ✓ 上传完成，继续上传更多文件
              </button>
            ) : null)}
        </div>

        {items.length > 0 && (
          <div className="stats-bar">
            <div>
              总速度: <span>{formatSpeed(totalSpeed)}</span>
            </div>
            <div>
              已完成: <span>{successCount}</span> / <span>{items.length}</span> 个文件
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default UploadPage;



