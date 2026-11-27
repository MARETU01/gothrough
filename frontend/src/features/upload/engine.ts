import { isAxiosError } from 'axios';
import { cancelUpload, completeUpload, getUploadStatus, initUpload, uploadChunk, type CompleteUploadResponse } from '@/services/upload';
import type { UploadController, UploadItem } from '@/types/upload';
import { MAX_CONCURRENT_UPLOADS, PROGRESS_REFRESH_INTERVAL } from '@/config/upload';
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

export const suspendItemForAuth = (item: UploadItem) => {
  const controller = item.uploadController;
  if (!controller || controller.cancelled) return;
  controller.authInterrupted = true;
  controller.abort.abort();
};

export class UploadMissingChunksError extends Error {
  readonly count: number;

  constructor(count: number) {
    super('The server still reports missing upload chunks');
    this.count = count;
  }
}

function chunkIndexes(value: unknown, totalChunks: number): Set<number> | null {
  if (!Array.isArray(value) || !value.every(index => Number.isInteger(index) && index >= 0 && index < totalChunks)) return null;
  return new Set<number>(value);
}

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
  const acceptCompletion = (complete: CompleteUploadResponse) => {
    checkActive();
    if (complete.status !== 'success' || typeof complete.saved_filename !== 'string' || !complete.saved_filename) {
      throw new Error("服务端返回的上传完成信息无效");
    }
    item.complete(complete.saved_filename);
  };
  const confirming = item.beginAttempt();
  if (!item.session) {
    // Observe late initialization responses so interrupted sessions can be retained or cleaned up.
    const path = getUploadPath(item.file);
    const data = await initUpload({
      filename: item.file.name,
      ...(path !== item.file.name ? { relative_path: path } : {}),
      total_size: item.file.size,
    });
    item.acceptSession({
      sessionId: data.session_id,
      totalChunks: data.total_chunks,
      chunkSize: data.chunk_size,
      receivedChunks: 0,
      finalFilename: data.final_filename,
    });
    checkActive();
  } else if (!confirming) {
    const status = await getUploadStatus(item.session.sessionId, controller.abort.signal);
    checkActive();
    if (status.status === 'success') {
      acceptCompletion(status);
      return;
    }
    const received = chunkIndexes(status.received_chunks, item.session.totalChunks);
    if (status.status !== 'uploading' || status.session_id !== item.session.sessionId ||
        status.total_chunks !== item.session.totalChunks || status.chunk_size !== item.session.chunkSize || !received) {
      throw new Error("服务端返回的分块配置无效");
    }
    item.reconcileChunks(received);
  }
  const session = item.session!;
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
  const finishSession = async () => {
    checkActive();
    item.beginCompletion();
    try {
      acceptCompletion(await completeUpload(session.sessionId, controller.abort.signal));
      return 0;
    } catch (error) {
      checkActive();
      const response = isAxiosError<{ code?: string; missing_chunks?: unknown }>(error) ? error.response : undefined;
      const missing = response?.status === 400 && response.data?.code === 'MISSING_CHUNKS'
        ? chunkIndexes(response.data.missing_chunks, session.totalChunks) : null;
      if (!missing?.size) throw error;
      const received: number[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        if (!missing.has(i)) received.push(i);
      }
      item.reconcileChunks(received);
      return missing.size;
    }
  };
  const sendChunks = async () => {
    let nextChunkIndex = 0;
    let lastPaint = 0;
    let failure: { cause: unknown } | undefined;
    const sendChunk = async (index: number) => {
      const chunk = item.file.slice(
        index * session.chunkSize,
        Math.min((index + 1) * session.chunkSize, item.file.size),
      );
      let attemptLoaded = 0;
      const recordTransferred = (loaded: number) => {
        item.recordTransferred(Math.max(0, loaded - attemptLoaded));
        attemptLoaded = Math.max(attemptLoaded, loaded);
      };
      const onProgress = (loaded: number, total: number) => {
        if (control.isStopped() || controller.abort.signal.aborted) return;
        const bytes = Math.min(chunk.size, Math.max(0, total > 0 ? (loaded / total) * chunk.size : loaded));
        recordTransferred(bytes);
        item.setInflight(index, bytes);
        if (Date.now() - lastPaint >= PROGRESS_REFRESH_INTERVAL) {
          lastPaint = Date.now();
          item.publishProgress();
        }
      };
      for (let retry = 0; ; retry++) {
        try {
          await uploadChunk({ sessionId: session.sessionId, chunkIndex: index, chunk, signal: controller.abort.signal, onProgress });
          break;
        } catch (err) {
          if (control.isStopped() || isCanceledError(err) || controller.abort.signal.aborted) throw err;
          const delay = uploadRetryDelay(err, retry);
          if (delay === null) throw err;
          item.discardInflight(index);
          attemptLoaded = 0;
          await waitForRetry(delay, controller.abort.signal);
          await waitForResume();
        }
      }
      checkActive();
      recordTransferred(chunk.size);
      item.confirmChunk(index, chunk.size);
    };
    const worker = async () => {
      try {
        while (nextChunkIndex < session.totalChunks) {
          const index = nextChunkIndex++;
          if (item.confirmedChunks.has(index)) continue;
          await waitForResume();
          await sendChunk(index);
        }
      } catch (cause) {
        failure ??= { cause };
        controller.abort.abort();
      }
    };
    // Wait for every worker to release its chunk before repairing or ending the attempt.
    await Promise.all(Array.from({ length: MAX_CONCURRENT_UPLOADS }, worker));
    if (failure) throw failure.cause;
    checkActive();
    await waitForResume();
  };

  if (!confirming) await sendChunks();
  if (!await finishSession()) return;
  await sendChunks();
  const missing = await finishSession();
  if (missing) throw new UploadMissingChunksError(missing);
}
