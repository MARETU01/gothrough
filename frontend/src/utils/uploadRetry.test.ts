import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadRetryDelay, waitForRetry } from './uploadRetry';

const failure = (status: number, retryAfter?: string, code?: string) => new AxiosError(
  'failed', undefined, undefined, undefined,
  { status, headers: new AxiosHeaders(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }), data: { code } } as AxiosResponse,
);

afterEach(() => vi.useRealTimers());

describe('chunk retry policy', () => {
  it('backs off transient failures and stops after two retries', () => {
    const network = new AxiosError('offline', 'ERR_NETWORK');
    expect(uploadRetryDelay(network, 0)).toBe(500);
    expect(uploadRetryDelay(network, 1)).toBe(1000);
    expect(uploadRetryDelay(network, 2)).toBeNull();
    for (const status of [408, 429, 500, 502, 503, 504]) expect(uploadRetryDelay(failure(status), 0)).toBe(500);
  });

  it('does not retry cancellation, invalid requests, or permanent storage errors', () => {
    for (const error of [new Error('unexpected'), new AxiosError('cancelled', 'ERR_CANCELED'),
      failure(400), failure(403), failure(404), failure(413), failure(507),
      failure(503, undefined, 'STORAGE_READ_ONLY'), failure(500, undefined, 'HARDLINK_UNSUPPORTED')]) {
      expect(uploadRetryDelay(error, 0)).toBeNull();
    }
  });

  it('honors Retry-After seconds and dates without retrying early', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(uploadRetryDelay(failure(429, '3'), 0, now)).toBe(3000);
    expect(uploadRetryDelay(failure(503, new Date(now + 5000).toUTCString()), 0, now)).toBe(5000);
    expect(uploadRetryDelay(failure(429, 'bad'), 1, now)).toBe(1000);
    expect(uploadRetryDelay(failure(429, '120'), 0, now)).toBeNull();
  });

  it('cancels a backoff immediately and removes its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitForRetry(10_000, controller.signal);
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
