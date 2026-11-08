import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';
import type { UploadController, UploadItem } from '@/types/upload';
import { CHUNK_SIZE, MAX_CONCURRENT_UPLOADS, PROGRESS_REFRESH_INTERVAL } from '@/config/upload';
import { UploadTask } from './task';
import { uploadRetryDelay, waitForRetry } from '@/utils/uploadRetry';
import { getUploadPath } from '@/utils/droppedFiles';
import { isCanceledError } from '@/utils/cancellation';

export interface TransferControl {
  isStopped: () => boolean;
  isPaused: () => boolean;
  waitForChange: (signal?: AbortSignal) => Promise<void>;
}

export const cleanupSession = async (item: UploadItem) => {
  if (!item.session) return;
  try {
    await cancelUpload(item.session.sessionId);
  } catch {
    /* Server must expire abandoned sessions too. */
  }
};
export const stopItem = (item: UploadItem) => {
  if (item.uploadController) {
    item.uploadController.cancelled = true;
    item.uploadController.abort.abort();
  }
};

// One file's protocol and chunk scheduling. React owns display state, clocks,
// lifecycle disposal, and deciding when to cancel an unsuccessful session.
export async function transferFile(item: UploadTask, controller: UploadController, control: TransferControl): Promise<void> {
  const checkActive = () => {
    if (control.isStopped() || controller.abort.signal.aborted)
      throw new Error("Upload cancelled");
  };
  const waitForResume = async () => {
    checkActive();
    while (control.isPaused()) {
      item.pauseTransfer();
      await control.waitForChange(controller.abort.signal);
      checkActive();
    }
    item.resumeTransfer();
  };
  const finishSession = async () => {
    checkActive();
    item.beginCompletion();
    const complete = await completeUpload(item.session!.sessionId, controller.abort.signal);
    checkActive();
    item.complete(complete.saved_filename);
  };
  if (item.beginAttempt()) { await finishSession(); return; }
  // Observe late initialization responses so cancelled sessions can be cleaned up.
  const data = await initUpload({
    filename: item.file.name,
    ...(getUploadPath(item.file) !== item.file.name
      ? { relative_path: getUploadPath(item.file) } : {}),
    total_size: item.file.size,
  });
  const session = {
    sessionId: data.session_id,
    totalChunks: data.total_chunks,
    chunkSize: data.chunk_size || CHUNK_SIZE,
    receivedChunks: 0,
    finalFilename: data.final_filename,
  };
  item.acceptSession(session);
  checkActive();
  if (
    !session.sessionId ||
    !Number.isInteger(session.totalChunks) ||
    session.totalChunks < 0 ||
    !Number.isFinite(session.chunkSize) ||
    session.chunkSize <= 0 ||
    session.totalChunks !== Math.ceil(item.file.size / session.chunkSize)
  ) {
    throw new Error("服务端返回的分块配置无效");
  }
  // Shared only by the workers for this file's current upload attempt.
  const transfer = {
    nextChunkIndex: 0,
    lastPaint: 0,
    failure: undefined as unknown,
  };
  const worker = async () => {
    try {
      while (transfer.nextChunkIndex < session.totalChunks) {
        await waitForResume();
        checkActive();
        if (transfer.nextChunkIndex >= session.totalChunks) return;
        const index = transfer.nextChunkIndex++;
        const chunk = item.file.slice(
          index * session.chunkSize,
          Math.min((index + 1) * session.chunkSize, item.file.size),
        );
        const attempt = { loaded: 0 };
        const recordTransferred = (loaded: number) => {
          item.recordTransferred(Math.max(0, loaded - attempt.loaded));
          attempt.loaded = Math.max(attempt.loaded, loaded);
        };
        const send = () =>
          uploadChunk({
            sessionId: session.sessionId,
            chunkIndex: index,
            chunk,
            transport: data.upload_transport,
            signal: controller.abort.signal,
            onProgress: (loaded, total) => {
              if (control.isStopped() || controller.abort.signal.aborted) return;
              const bytes = Math.min(
                chunk.size,
                Math.max(
                  0,
                  total > 0 ? (loaded / total) * chunk.size : loaded,
                ),
              );
              recordTransferred(bytes);
              item.setInflight(index, bytes);
              if (Date.now() - transfer.lastPaint >= PROGRESS_REFRESH_INTERVAL) {
                transfer.lastPaint = Date.now();
                item.publishProgress();
              }
            },
          });
        for (let retry = 0; ; retry++) {
          try {
            await send();
            break;
          } catch (err) {
            if (control.isStopped() || isCanceledError(err) || controller.abort.signal.aborted) throw err;
            const delay = uploadRetryDelay(err, retry);
            if (delay === null) throw err;
            item.discardInflight(index);
            attempt.loaded = 0;
            await waitForRetry(delay, controller.abort.signal);
            await waitForResume();
          }
        }
        checkActive();
        if (controller.abort.signal.aborted) return;
        recordTransferred(chunk.size);
        item.confirmChunk(index, chunk.size);
      }
    } catch (err) {
      if (transfer.failure === undefined) transfer.failure = err;
      controller.abort.abort();
      throw err;
    }
  };
  // A file slot is released only after every worker has stopped.
  await Promise.allSettled(
    Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker),
  );
  if (transfer.failure !== undefined) throw transfer.failure;
  checkActive();
  await waitForResume();
  await finishSession();
}
