/**
 * 上传队列的应用层类型定义（页面 / hook / 工具函数共用）。
 * 服务端请求 / 响应 DTO 仍定义在 @/services/upload，此处只放 UI 状态相关结构。
 */

/** 单个文件的上传状态机 */
export type UploadState = 'pending' | 'uploading' | 'paused' | 'success' | 'error';

/** 服务端初始化会话后的本地会话快照 */
export interface UploadSession {
  sessionId: string;
  totalChunks: number;
  chunkSize: number;
  totalSize: number;
  receivedChunks: number;
  finalFilename: string;
}

/** 单文件上传控制器：暂停 / 取消标志 + AbortController */
export interface UploadController {
  paused: boolean;
  cancelled: boolean;
  /** 取消时立即中断进行中的 axios 分块请求 */
  abort: AbortController;
}

/** 队列中的单个上传项（itemsRef / items 数组元素） */
export interface UploadItem {
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

/** 顶部状态提示消息 */
export interface StatusMessage {
  text: string;
  type: 'success' | 'error';
}

/** 状态对应的中文标签（供 UI 直接渲染） */
export const STATE_LABELS: Record<UploadState, string> = {
  pending: '⏳ 待上传',
  uploading: '📤 上传中',
  paused: '⏸ 已暂停',
  success: '✅ 上传成功',
  error: '❌ 上传失败',
};
