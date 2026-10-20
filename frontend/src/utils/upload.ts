import type { UploadItem, UploadViewItem } from '@/types/upload';

export const createUploadSnapshot = (item: UploadItem, previous?: UploadViewItem): UploadViewItem => {
  if (previous && previous.file === item.file && previous.state === item.state &&
    previous.speed === item.speed && previous.savedFilename === item.savedFilename &&
    previous.loadedBytes === item.loadedBytes && previous.error === item.error &&
    previous.session?.sessionId === item.session?.sessionId &&
    previous.session?.receivedChunks === item.session?.receivedChunks) return previous;
  return {
    file: item.file, state: item.state, speed: item.speed, savedFilename: item.savedFilename,
    loadedBytes: item.loadedBytes, error: item.error,
    session: item.session ? { ...item.session } : null,
  };
};

/** 生成文件唯一 key：name + size + lastModified，用于去重与 React key */
export const getFileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

/**
 * 汇总「服务端已确认的分块字节 + 正在传输分块的实时已发送字节」，
 * 结果裁剪到 [0, file.size]，供进度条与剩余时间使用。
 * 就地修改 item.loadedBytes（与原实现保持一致）。
 */
export const recalcLoadedBytes = (item: UploadItem) => {
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
  let confirmed = 0;
  item.confirmedBytes.forEach((bytes) => { confirmed += bytes; });
  // Retrying a chunk should not make the displayed progress jump backwards.
  item.loadedBytes = Math.min(file.size, Math.max(item.loadedBytes, confirmed + inflight));
};
