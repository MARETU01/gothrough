import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { responseApi } from './http';
import { listClipboard } from './clipboard';

const originalAdapter = responseApi.defaults.adapter;
afterEach(() => { responseApi.defaults.adapter = originalAdapter; });

function respond(status: number, data: unknown, etag?: string) {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const response = { status, statusText: '', data, headers: new AxiosHeaders(etag ? { etag } : {}), config };
    if (!config.validateStatus?.(status)) throw new AxiosError('request failed', undefined, config, undefined, response);
    return response;
  });
  responseApi.defaults.adapter = adapter;
  return adapter;
}

it('reads data and validator from a full response and sends a conditional header on later reads', async () => {
  const signal = new AbortController().signal;
  const adapter = respond(200, { entries: [] }, '"v1"');
  expect(await listClipboard(signal)).toEqual({ entries: [], etag: '"v1"' });
  expect(adapter.mock.calls[0][0].headers.get('If-None-Match')).toBeUndefined();
  expect(adapter.mock.calls[0][0].signal).toBe(signal);
  const unchanged = respond(304, '', '"v1"');
  expect(await listClipboard(signal, '"v1"')).toEqual({ notModified: true, etag: '"v1"' });
  expect(unchanged.mock.calls[0][0].headers.get('If-None-Match')).toBe('"v1"');
});

it('accepts a changed representation and tolerates servers without validators', async () => {
  respond(200, { entries: [{ id: 'new', type: 'text', text: 'text', created_at: 'date' }] }, '"v2"');
  expect(await listClipboard(undefined, '"v1"')).toMatchObject({ etag: '"v2"', entries: [{ id: 'new' }] });
  respond(200, { entries: [] });
  expect(await listClipboard()).toEqual({ entries: [], etag: undefined });
  respond(304, '');
  expect(await listClipboard(undefined, '"v1"')).toEqual({ notModified: true, etag: '"v1"' });
});

it('rejects HTTP failures and unsolicited 304 responses without a local snapshot', async () => {
  respond(500, { error: 'failed' });
  await expect(listClipboard(undefined, '"v1"')).rejects.toBeInstanceOf(AxiosError);
  respond(304, '');
  await expect(listClipboard()).rejects.toBeInstanceOf(AxiosError);
});
