import { beforeEach, expect, it, vi } from 'vitest';
import { cleanupSession, transferFile } from './engine';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';
import type { UploadController, UploadItem } from '@/types/upload';

vi.mock('@/services/upload', () => ({
  cancelUpload: vi.fn(), completeUpload: vi.fn(), initUpload: vi.fn(), uploadChunk: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

function item(): UploadItem {
  return {
    file: new File(['hello'], 'file.txt'), state: 'pending', error: '', session: null,
    speed: 0, savedFilename: '', uploadController: null, inflightBytes: new Map(),
    confirmedChunks: new Set(), confirmedBytes: 0, transferredBytes: 0, loadedBytes: 0, elapsedMs: null,
  };
}

it('runs a file transfer without mounting React and publishes progress through callbacks', async () => {
  vi.mocked(initUpload).mockResolvedValue({ session_id: 'session', total_chunks: 1, chunk_size: 5, final_filename: 'file.txt' });
  vi.mocked(uploadChunk).mockResolvedValue({ received: 1 });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'published.txt' });
  const upload = item();
  const controller: UploadController = { cancelled: false, abort: new AbortController() };
  const onChange = vi.fn();
  await transferFile(upload, controller, {
    isStopped: () => false, isPaused: () => false, waitForChange: async () => {}, onChange,
  });
  expect(upload.state).toBe('success');
  expect(upload.savedFilename).toBe('published.txt');
  expect(upload.loadedBytes).toBe(5);
  expect(upload.confirmedChunks.size).toBe(1);
  expect(onChange).toHaveBeenCalled();
  expect(cancelUpload).not.toHaveBeenCalled();
});

it('preserves a late initialization receipt so the lifecycle owner can clean up cancellation', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof initUpload>>) => void;
  vi.mocked(initUpload).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const upload = item();
  const controller: UploadController = { cancelled: false, abort: new AbortController() };
  let stopped = false;
  const result = transferFile(upload, controller, {
    isStopped: () => stopped, isPaused: () => false, waitForChange: async () => {}, onChange: () => {},
  });
  stopped = true;
  resolve({ session_id: 'late', total_chunks: 1, chunk_size: 5, final_filename: 'file.txt' });
  await expect(result).rejects.toThrow('Upload cancelled');
  expect(upload.session?.sessionId).toBe('late');
  await cleanupSession(upload);
  expect(cancelUpload).toHaveBeenCalledWith('late');
  expect(uploadChunk).not.toHaveBeenCalled();
});
