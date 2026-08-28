import type { UploadItem } from '@/types/upload';

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
  const confirmed = Math.min(session.receivedChunks * session.chunkSize, file.size);
  item.loadedBytes = Math.min(file.size, confirmed + inflight);
};
