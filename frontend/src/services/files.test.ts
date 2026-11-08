import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import api, { responseApi } from './http';
import { deleteSelection, downloadSelectionUrl, getDiskInfo, listFiles } from './files';

const originalResponseAdapter = responseApi.defaults.adapter;
const originalAdapter = api.defaults.adapter;
afterEach(() => { responseApi.defaults.adapter = originalResponseAdapter; api.defaults.adapter = originalAdapter; });

it('encodes literal bulk paths and sends typed deletion entries', async () => {
  const paths = ['文件 & ?.txt', 'folder/a.txt'];
  expect(new URL(downloadSelectionUrl(paths), 'http://localhost').searchParams.getAll('path')).toEqual(paths);
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ status: 200, statusText: '', data: { results: [] }, headers: new AxiosHeaders(), config }));
  api.defaults.adapter = adapter;
  const entries = [{ path: '文件 & ?.txt', folder: false }, { path: 'folder', folder: true }];
  await deleteSelection(entries);
  expect(adapter.mock.calls[0][0].url).toBe('/batch-delete');
  expect(JSON.parse(adapter.mock.calls[0][0].data)).toEqual({ entries });
});

function respond(status: number, data: unknown, etag?: string) {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const response = { status, statusText: '', data, headers: new AxiosHeaders(etag ? { etag } : {}), config };
    if (!config.validateStatus?.(status)) throw new AxiosError('request failed', undefined, config, undefined, response);
    return response;
  });
  responseApi.defaults.adapter = adapter;
  return adapter;
}

it('requests a compact snapshot and sends validators only when provided', async () => {
  const signal = new AbortController().signal;
  const adapter = respond(200, { files: [], total_size_display: '0 B' }, '"v1"');
  expect(await listFiles(signal)).toEqual({ files: [], total_size_display: '0 B', etag: '"v1"' });
  expect(adapter.mock.calls[0][0].url).toBe('/files?view=list');
  expect(adapter.mock.calls[0][0].signal).toBe(signal);
  expect(adapter.mock.calls[0][0].headers.get('If-None-Match')).toBeUndefined();
  const unchanged = respond(304, '');
  expect(await listFiles(signal, '"v1"')).toEqual({ notModified: true, etag: '"v1"' });
  expect(unchanged.mock.calls[0][0].headers.get('If-None-Match')).toBe('"v1"');
});

it('rejects errors and 304 without a snapshot, and accepts new versions or servers without etags', async () => {
  respond(304, ''); await expect(listFiles()).rejects.toBeInstanceOf(AxiosError);
  respond(500, {}); await expect(listFiles(undefined, '"v1"')).rejects.toBeInstanceOf(AxiosError);
  respond(200, { files: [], total_size_display: '0 B' }, '"v2"');
  expect(await listFiles(undefined, '"v1"')).toMatchObject({ etag: '"v2"' });
  respond(200, { files: [], total_size_display: '0 B' });
  expect(await listFiles()).toMatchObject({ etag: undefined });
});

it('refreshes disk state independently without a file-list validator', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ status: 200, statusText: '', data: { disk_pct: 42 }, headers: new AxiosHeaders(), config }));
  api.defaults.adapter = adapter;
  expect(await getDiskInfo()).toMatchObject({ disk_pct: 42 });
  expect(adapter.mock.calls[0][0].url).toBe('/disk-info');
  expect(adapter.mock.calls[0][0].headers.get('If-None-Match')).toBeUndefined();
});

it('encodes server-side directory, search, sorting, and pagination', async () => {
  const adapter = respond(200, { files: [], directory: '文档/照片', total: 0, total_size_display: '0 B' });
  await listFiles(undefined, undefined, { directory: '文档/照片', search: 'a & b', sort: 'size_desc', page: 2, pageSize: 20 });
  const url = new URL(adapter.mock.calls[0][0].url!, 'http://localhost');
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'browser', dir: '文档/照片', q: 'a & b', sort: 'size_desc', page: '2', page_size: '20' });
});
