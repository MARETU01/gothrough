import type { UploadItem, UploadViewItem } from "@/types/upload";
import { getUploadPath } from "./droppedFiles";

export const createUploadSnapshot = (
  item: UploadItem,
  previous?: UploadViewItem,
): UploadViewItem => {
  if (
    previous &&
    previous.file === item.file &&
    previous.state === item.state &&
    previous.speed === item.speed &&
    previous.savedFilename === item.savedFilename &&
    previous.loadedBytes === item.loadedBytes &&
    previous.error === item.error &&
    previous.elapsedMs === item.elapsedMs &&
    previous.session?.sessionId === item.session?.sessionId &&
    previous.session?.receivedChunks === item.session?.receivedChunks
  )
    return previous;
  return {
    file: item.file,
    state: item.state,
    speed: item.speed,
    savedFilename: item.savedFilename,
    loadedBytes: item.loadedBytes,
    error: item.error,
    elapsedMs: item.elapsedMs,
    session: item.session ? { ...item.session } : null,
  };
};

/** Include the path so equal filenames in different folders remain distinct. */
export const getFileKey = (file: File) =>
  `${getUploadPath(file)}-${file.size}-${file.lastModified}`;

/** Count each acknowledgement once, including short final chunks. */
export const confirmChunk = (item: UploadItem, index: number, bytes: number) => {
  if (item.confirmedChunks.has(index)) return;
  item.confirmedChunks.add(index);
  item.confirmedBytes += bytes;
};

/**
 * 汇总「服务端已确认的分块字节 + 正在传输分块的实时已发送字节」，
 * 结果裁剪到 [0, file.size]，供进度条与剩余时间使用。
 * 就地修改 item.loadedBytes（与原实现保持一致）。
 */
export const recalcLoadedBytes = (item: UploadItem) => {
  const { session, file } = item;
  if (item.state === "success") {
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
  // Retrying a chunk should not make the displayed progress jump backwards.
  item.loadedBytes = Math.min(
    file.size,
    Math.max(item.loadedBytes, item.confirmedBytes + inflight),
  );
};
