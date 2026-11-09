import api from './http';
import { uploadRetryDelay, waitForRetry } from '@/utils/uploadRetry';

/**
 * 大文件分块上传相关接口。
 *
 * 统一复用 src/services/http.ts 中封装的 axios 实例：
 *   - baseURL: '/api'  → 实际请求 /api/upload/init、/api/upload/chunk、
 *                        /api/upload/complete、/api/upload/cancel
 *   - 响应拦截器已取出 data，所以这里用 post<T, T> 让返回值直接是业务数据
 *
 */

/** 接口路径（相对于 api 实例的 baseURL） */
export const UPLOAD_ENDPOINTS = {
  init: '/upload/init',
  chunk: '/upload/chunk',
  complete: '/upload/complete',
  cancel: '/upload/cancel',
} as const;

/* ==================== 数据结构 ==================== */
export interface InitUploadRequest {
  filename: string;
  relative_path?: string;
  total_size: number;
}

export interface InitUploadResponse {
  session_id: string;
  total_chunks: number;
  chunk_size: number;
  final_filename: string;
}

export interface UploadChunkResponse {
  received: number;
}

export interface CompleteUploadResponse {
  status: 'success';
  saved_filename: string;
}

export interface CancelUploadResponse {
  status: 'cancelled';
}

/* ==================== 接口封装 ==================== */

/** 初始化上传会话：POST /api/upload/init */
export function initUpload(payload: InitUploadRequest) {
  return api.post<InitUploadResponse, InitUploadResponse>(UPLOAD_ENDPOINTS.init, payload);
}

export interface UploadChunkOptions {
  sessionId: string;
  chunkIndex: number;
  /** 分块二进制内容（File.slice 的结果） */
  chunk: Blob;
  /** 取消信号：abort 后立即中断该分块请求（axios 原生支持） */
  signal?: AbortSignal;
  /**
   * axios 上传进度回调：本分块已发送字节 / 本分块总字节。
   * 进度总量以当前分块大小为准。
   */
  onProgress?: (loaded: number, total: number) => void;
}

/** 上传单个分块，直接发送二进制请求体。 */
export function uploadChunk({
  sessionId,
  chunkIndex,
  chunk,
  signal,
  onProgress,
}: UploadChunkOptions) {
  return api.post<UploadChunkResponse, UploadChunkResponse>(UPLOAD_ENDPOINTS.chunk, chunk, {
    params: { session_id: sessionId, chunk_index: chunkIndex },
    headers: { 'Content-Type': 'application/octet-stream' },
    // 分块可能很大，覆盖实例默认的 30s 超时，避免中途被 abort
    timeout: 0,
    signal,
    onUploadProgress: (event) => {
      if (!onProgress) return;
      onProgress(event.loaded, event.total ?? chunk.size);
    },
  });
}

/** 校验并发布文件：POST /api/upload/complete */
export async function completeUpload(sessionId: string, signal?: AbortSignal): Promise<CompleteUploadResponse> {
  const abort = signal ?? new AbortController().signal;
  for (let retry = 0; ; retry++) {
    try {
      // fsync for a large file can take longer than the default request timeout.
      return await api.post<CompleteUploadResponse, CompleteUploadResponse>(UPLOAD_ENDPOINTS.complete, {
        session_id: sessionId,
      }, { signal: abort, timeout: 0 });
    } catch (error) {
      if (abort.aborted || uploadRetryDelay(error, 0) === null) throw error;
      // The publication may have succeeded even though its response was lost.
      try {
        const result = await api.get<CompleteUploadResponse | { status: 'uploading' }, CompleteUploadResponse | { status: 'uploading' }>(
          '/upload/status/' + encodeURIComponent(sessionId), { signal: abort });
        if (result.status === 'success') return result;
      } catch { /* Preserve the original failure if confirmation also fails. */ }
      if (abort.aborted) throw error;
      const delay = uploadRetryDelay(error, retry);
      if (delay === null) throw error;
      await waitForRetry(delay, abort);
    }
  }
}

/** 放弃上传、清理服务端会话：POST /api/upload/cancel */
export function cancelUpload(sessionId: string) {
  return api.post<CancelUploadResponse, CancelUploadResponse>(UPLOAD_ENDPOINTS.cancel, {
    session_id: sessionId,
  });
}
