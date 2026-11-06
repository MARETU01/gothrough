import { AxiosHeaders, isAxiosError } from 'axios';

/** Two retries for transient chunk failures; permanent storage errors fail fast. */
export function uploadRetryDelay(error: unknown, retry: number, now = Date.now()): number | null {
  if (retry >= 2 || !isAxiosError(error)) return null;
  const status = error.response?.status;
  const code = error.response?.data?.code;
  if (typeof code === 'string' && (code.startsWith('STORAGE_') || code === 'HARDLINK_UNSUPPORTED')) return null;
  if (status !== undefined) {
    if (![408, 429, 500, 502, 503, 504].includes(status)) return null;
  } else if (!['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? '')) {
    return null;
  }
  const backoff = 500 * 2 ** retry;
  const headers = error.response?.headers;
  const header = headers instanceof AxiosHeaders ? headers.get('retry-after')
    : Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  if (header === undefined) return backoff;
  const value = String(header).trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(delay)) return backoff;
  // Do not silently retry earlier than a server's long waiting period.
  return delay > 60_000 ? null : Math.max(backoff, delay);
}

export function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}
