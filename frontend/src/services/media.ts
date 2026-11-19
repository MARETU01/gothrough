export type MediaFailure = 'network' | 'missing' | 'unsupported' | 'busy' | 'failed';
export class MediaPreviewError extends Error {
  readonly reason: MediaFailure;
  constructor(reason: MediaFailure) { super('Media preview: ' + reason); this.reason = reason; }
}
export const mediaFailure = (error: unknown): MediaFailure => error instanceof MediaPreviewError ? error.reason : 'network';

// Probe only a byte, then cancel the stream. Never buffer an entire media file.
// Native media tags bypass the HTTP client's authentication interceptor.
export async function checkMedia(url: string, signal?: AbortSignal, expectedType?: string): Promise<void> {
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MediaPreviewError('network');
  }
  if (response.status === 401) {
    try {
      const body = await response.json();
      if (!signal?.aborted && body.code === 'AUTH_REQUIRED') window.dispatchEvent(new Event('gothrough:auth-required'));
    } finally { await response.body?.cancel().catch(() => {}); }
    throw new MediaPreviewError('failed');
  }
  await response.body?.cancel();
  if (!response.ok) throw new MediaPreviewError(response.status === 404 ? 'missing' : response.status === 415 ? 'unsupported' : response.status === 429 ? 'busy' : 'failed');
  if (expectedType && response.headers.get('Content-Type')?.split(';')[0].trim() !== expectedType) throw new MediaPreviewError('unsupported');
}
