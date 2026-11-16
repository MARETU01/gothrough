// Probe only a byte, then cancel the stream. Never buffer an entire media file.
// Native media tags bypass the HTTP client's authentication interceptor.
export async function checkMedia(url: string, signal?: AbortSignal, expectedType?: string): Promise<void> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  if (response.status === 401) {
    try {
      const body = await response.json();
      if (!signal?.aborted && body.code === 'AUTH_REQUIRED') window.dispatchEvent(new Event('gothrough:auth-required'));
    } finally { await response.body?.cancel().catch(() => {}); }
    throw new Error('Media authentication failed');
  }
  await response.body?.cancel();
  if (!response.ok || (expectedType && response.headers.get('Content-Type')?.split(';')[0].trim() !== expectedType)) throw new Error('Media unavailable');
}
