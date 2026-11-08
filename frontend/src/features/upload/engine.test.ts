import { beforeEach, expect, it, vi } from 'vitest';
import { UploadTask } from './task';
import { cleanupSession, transferFile } from './engine';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';
import { createUploadSnapshot } from '@/utils/upload';
import type { UploadController, UploadViewItem } from '@/types/upload';

vi.mock('@/services/upload', () => ({
  cancelUpload: vi.fn(), completeUpload: vi.fn(), initUpload: vi.fn(), uploadChunk: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

function item(onChange?: () => void): UploadTask {
  return new UploadTask(new File(['hello'], 'file.txt'), onChange);
}

it('runs a file transfer without mounting React and publishes progress through callbacks', async () => {
  vi.mocked(initUpload).mockResolvedValue({ session_id: 'session', total_chunks: 1, chunk_size: 5, final_filename: 'file.txt' });
  vi.mocked(uploadChunk).mockResolvedValue({ received: 1 });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'published.txt' });
  const snapshots: UploadViewItem[] = [];
  const onChange = vi.fn(() => snapshots.push(createUploadSnapshot(upload)));
  const upload = item(onChange);
  const controller: UploadController = { cancelled: false, abort: new AbortController() };
  await transferFile(upload, controller, {
    isStopped: () => false, isPaused: () => false, waitForChange: async () => {},
  });
  expect(upload.state).toBe('success');
  expect(upload.savedFilename).toBe('published.txt');
  expect(upload.loadedBytes).toBe(5);
  expect(upload.confirmedChunks.size).toBe(1);
  expect(onChange).toHaveBeenCalled();
  expect(snapshots.at(-1)).toMatchObject({ state: "success", savedFilename: "published.txt", loadedBytes: 5 });
  // Existing React snapshots cannot change when a later acknowledgement arrives.
  expect(snapshots.find(snapshot => snapshot.session)?.session?.receivedChunks).toBe(0);
  expect(snapshots.at(-1)?.session?.receivedChunks).toBe(1);
  expect(cancelUpload).not.toHaveBeenCalled();
});

it('preserves a late initialization receipt so the lifecycle owner can clean up cancellation', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof initUpload>>) => void;
  vi.mocked(initUpload).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const upload = item();
  const controller: UploadController = { cancelled: false, abort: new AbortController() };
  let stopped = false;
  const result = transferFile(upload, controller, {
    isStopped: () => stopped, isPaused: () => false, waitForChange: async () => {},
  });
  stopped = true;
  resolve({ session_id: 'late', total_chunks: 1, chunk_size: 5, final_filename: 'file.txt' });
  await expect(result).rejects.toThrow('Upload cancelled');
  expect(upload.session?.sessionId).toBe('late');
  await cleanupSession(upload);
  expect(cancelUpload).toHaveBeenCalledWith('late');
  expect(uploadChunk).not.toHaveBeenCalled();
});
