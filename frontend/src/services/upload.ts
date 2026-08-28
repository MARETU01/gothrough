import axios, { isAxiosError } from 'axios';
import api from './http';

/**
 * 大文件分块上传相关接口。
 *
 * 统一复用 src/services/http.ts 中封装的 axios 实例：
 *   - baseURL: '/api'  → 实际请求 /api/upload/init、/api/upload/chunk、
 *                        /api/upload/complete、/api/upload/cancel
 *   - 响应拦截器已取出 data，所以这里用 post<T, T> 让返回值直接是业务数据
 *
 * 请求体 / 响应体的字段与原 submit.html 中的 fetch 调用完全一致。
 */

/** 接口路径（相对于 api 实例的 baseURL） */
export const UPLOAD_ENDPOINTS = {
  init: '/upload/init',
  chunk: '/upload/chunk',
  complete: '/upload/complete',
  cancel: '/upload/cancel',
} as const;

/* ==================== 数据结构（与原页面保持一致） ==================== */
export interface InitUploadRequest {
  filename: string;
  total_size: number;
}

export interface InitUploadResponse {
  session_id: string;
  total_chunks: number;
  chunk_size: number;
  final_filename: string;
  error?: string;
}

export interface UploadChunkResponse {
  received: number;
  error?: string;
}

export interface CompleteUploadResponse {
  saved_filename?: string;
  missing_chunks?: number[];
  error?: string;
}

export interface CancelUploadResponse {
  status?: string;
  error?: string;
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
   * 注意 multipart 请求体含边界开销，loaded 可能略大于 chunk.size，调用方需自行裁剪。
   */
  onProgress?: (loaded: number, total: number) => void;
}

/** 上传单个分块：POST /api/upload/chunk（multipart/form-data） */
export function uploadChunk({
  sessionId,
  chunkIndex,
  chunk,
  signal,
  onProgress,
}: UploadChunkOptions) {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('chunk_index', String(chunkIndex));
  form.append('chunk', chunk);

  return api.post<UploadChunkResponse, UploadChunkResponse>(UPLOAD_ENDPOINTS.chunk, form, {
    // 分块可能很大，覆盖实例默认的 30s 超时，避免中途被 abort
    timeout: 0,
    signal,
    onUploadProgress: (event) => {
      if (!onProgress) return;
      onProgress(event.loaded, event.total ?? chunk.size);
    },
  });
}

/** 合并分块、完成上传：POST /api/upload/complete */
export function completeUpload(sessionId: string) {
  return api.post<CompleteUploadResponse, CompleteUploadResponse>(UPLOAD_ENDPOINTS.complete, {
    session_id: sessionId,
  });
}

/** 放弃上传、清理服务端会话：POST /api/upload/cancel */
export function cancelUpload(sessionId: string) {
  return api.post<CancelUploadResponse, CancelUploadResponse>(UPLOAD_ENDPOINTS.cancel, {
    session_id: sessionId,
  });
}

/* ==================== 错误辅助 ==================== */

/** 请求是否被主动取消（axios 的 CanceledError / ERR_CANCELED） */
export function isCanceledError(error: unknown): boolean {
  return isAxiosError(error) && (axios.isCancel(error) || error.code === 'ERR_CANCELED');
}

/** 从 axios 错误中取出后端返回的结构体（如 { error } / { missing_chunks }） */
export function getErrorBody<T>(error: unknown): T | null {
  if (!isAxiosError<T>(error)) return null;
  const data = error.response?.data;
  return (data ?? null) as T | null;
}
