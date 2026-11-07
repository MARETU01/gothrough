import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from './http';
import { completeUpload, uploadChunk } from './upload';

vi.mock('./http', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

it('sends the original Blob as a raw body with negotiated metadata and abort signal', () => {
  const chunk = new Blob(['hello']);
  const signal = new AbortController().signal;
  const onProgress = vi.fn();
  uploadChunk({ sessionId: 'session', chunkIndex: 2, chunk, signal, transport: 'raw', onProgress });
  const [url, body, options] = vi.mocked(api.post).mock.calls[0];
  expect(url).toBe('/upload/chunk');
  expect(body).toBe(chunk);
  expect(options).toMatchObject({ params: { session_id: 'session', chunk_index: 2 }, headers: { 'Content-Type': 'application/octet-stream' }, signal, timeout: 0 });
  options?.onUploadProgress?.({ loaded: 3, total: 5 } as never);
  expect(onProgress).toHaveBeenCalledWith(3, 5);
});

it('retains multipart transport for servers that do not advertise raw support', () => {
  uploadChunk({ sessionId: 'old', chunkIndex: 0, chunk: new Blob(['hello']) });
  const [, body, options] = vi.mocked(api.post).mock.calls[0];
  expect(body).toBeInstanceOf(FormData);
  expect((body as FormData).get('session_id')).toBe('old');
  expect((body as FormData).get('chunk_index')).toBe('0');
  expect(options?.headers).toBeUndefined();
});

it('confirms a lost completion response without publishing again', async () => {
  vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, code: 'ERR_NETWORK' });
  const receipt = { status: 'success', saved_filename: 'original.txt', size: 5 };
  vi.mocked(api.get).mockResolvedValueOnce(receipt);
  const signal = new AbortController().signal;
  await expect(completeUpload('session', signal)).resolves.toEqual(receipt);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/upload/complete', { session_id: 'session' }, { signal, timeout: 0 });
  expect(api.get).toHaveBeenCalledWith('/upload/status/session', { signal });
});

it('retries completion using the same session after a transient failure', async () => {
  vi.useFakeTimers();
  vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
    .mockResolvedValueOnce({ saved_filename: 'original.txt' });
  vi.mocked(api.get).mockResolvedValueOnce({ status: 'uploading' });
  const result = completeUpload('same-session');
  await vi.advanceTimersByTimeAsync(500);
  await expect(result).resolves.toEqual({ saved_filename: 'original.txt' });
  expect(api.post).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(api.post).mock.calls) expect(call[1]).toEqual({ session_id: 'same-session' });
});
