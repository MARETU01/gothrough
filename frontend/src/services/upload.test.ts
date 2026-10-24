import { beforeEach, expect, it, vi } from 'vitest';
import api from './http';
import { uploadChunk } from './upload';

vi.mock('./http', () => ({ default: { post: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

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
