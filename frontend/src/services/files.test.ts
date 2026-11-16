import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import api, { responseApi } from './http';
import { createSpreadsheetSaveAttempt, deleteSelection, downloadSelectionUrl, getDiskInfo, getSpreadsheetPreview, getSpreadsheetSaveStatus, saveSpreadsheet, saveSpreadsheetOperation, listFiles, type FileListData } from './files';

const originalResponseAdapter = responseApi.defaults.adapter;
const originalAdapter = api.defaults.adapter;

it('encodes workbook paths and saves versioned changes without a fixed timeout', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ status: 200, statusText: '', data: {}, headers: new AxiosHeaders(), config }));
  api.defaults.adapter = adapter;
  const controller = new AbortController();
  await getSpreadsheetPreview('目录/表 格.xlsx', controller.signal);
  expect(adapter.mock.calls[0][0].url).toBe('/files/' + encodeURIComponent('目录/表 格.xlsx') + '?preview=info');
  expect(adapter.mock.calls[0][0].signal).toBe(controller.signal);
  const changes = [{ sheet: 'Sheet1', cell: 'B2', type: 'number' as const, value: '23.5' }];
  await saveSpreadsheet('目录/表 格.xlsx', 'v1', changes);
  expect(adapter.mock.calls[1][0].url).toBe('/spreadsheets/' + encodeURIComponent('目录/表 格.xlsx'));
  expect(adapter.mock.calls[1][0].timeout).toBe(0);
  expect(JSON.parse(adapter.mock.calls[1][0].data)).toEqual({ version: 'v1', changes });
});
afterEach(() => { responseApi.defaults.adapter = originalResponseAdapter; api.defaults.adapter = originalAdapter; });

it('retains immutable save payloads and uses an operation identifier for confirmation', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ status: 200, statusText: '', data: { status: 'saved', version: 'v2' }, headers: new AxiosHeaders(), config }));
  api.defaults.adapter = adapter;
  const changes = [{ sheet: '预算', cell: 'B2', type: 'text' as const, value: 'original' }];
  const attempt = createSpreadsheetSaveAttempt('v1', changes);
  expect(attempt.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  changes[0].value = 'later edit';
  await saveSpreadsheetOperation('目录/表.xlsx', attempt);
  expect(JSON.parse(adapter.mock.calls[0][0].data)).toEqual({ operation_id: attempt.id, version: 'v1', changes: [{ sheet: '预算', cell: 'B2', type: 'text', value: 'original' }] });
  expect(adapter.mock.calls[0][0].timeout).toBe(0);
  await getSpreadsheetSaveStatus('目录/表.xlsx', attempt.id);
  expect(adapter.mock.calls[1][0].url).toBe('/spreadsheet-saves/' + attempt.id);
  expect(adapter.mock.calls[1][0].params).toEqual({ filename: '目录/表.xlsx' });
});

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

it('keeps large deletions cancellable without the default 30-second timeout', async () => {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({ status: 200, statusText: '', data: { results: [] }, headers: new AxiosHeaders(), config }));
  api.defaults.adapter = adapter;
  const controller = new AbortController();
  await deleteSelection([{ path: 'folder', folder: true }], controller.signal);
  expect(adapter.mock.calls[0][0].timeout).toBe(0);
  expect(adapter.mock.calls[0][0].signal).toBe(controller.signal);
});

it('requests a fresh disk scan for explicit refresh', async () => {
  const adapter = respond(200, emptyList);
  await listFiles(undefined, undefined, { directory: '', search: '', sort: 'mtime_desc', page: 1, pageSize: 20, refresh: true });
  expect(new URL(adapter.mock.calls[0][0].url!, 'http://localhost').searchParams.get('refresh')).toBe('1');
});

const emptyList: FileListData = { files: [], total_size_display: '0 B', directory: '', total: 0,
  folder_count: 0, total_files: 0, page: 1, page_size: 20, total_pages: 1 };

function respond(status: number, data: unknown, etag?: string) {
  const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const response = { status, statusText: '', data, headers: new AxiosHeaders(etag ? { etag } : {}), config };
    if (!config.validateStatus?.(status)) throw new AxiosError('request failed', undefined, config, undefined, response);
    return response;
  });
  responseApi.defaults.adapter = adapter;
  return adapter;
}

it('defaults to the browser snapshot and sends validators only when provided', async () => {
  const signal = new AbortController().signal;
  const adapter = respond(200, emptyList, '"v1"');
  expect(await listFiles(signal)).toEqual({ ...emptyList, etag: '"v1"' });
  expect(adapter.mock.calls[0][0].url).toBe('/files?view=browser');
  expect(adapter.mock.calls[0][0].signal).toBe(signal);
  expect(adapter.mock.calls[0][0].headers.get('If-None-Match')).toBeUndefined();
  const unchanged = respond(304, '');
  expect(await listFiles(signal, '"v1"')).toEqual({ notModified: true, etag: '"v1"' });
  expect(unchanged.mock.calls[0][0].headers.get('If-None-Match')).toBe('"v1"');
});

it('rejects errors and 304 without a snapshot, and accepts new versions or servers without etags', async () => {
  respond(304, ''); await expect(listFiles()).rejects.toBeInstanceOf(AxiosError);
  respond(500, {}); await expect(listFiles(undefined, '"v1"')).rejects.toBeInstanceOf(AxiosError);
  respond(200, emptyList, '"v2"');
  expect(await listFiles(undefined, '"v1"')).toMatchObject({ etag: '"v2"' });
  respond(200, emptyList);
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
  const adapter = respond(200, { ...emptyList, directory: '文档/照片' });
  await listFiles(undefined, undefined, { directory: '文档/照片', search: 'a & b', sort: 'size_desc', page: 2, pageSize: 20 });
  const url = new URL(adapter.mock.calls[0][0].url!, 'http://localhost');
  expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'browser', dir: '文档/照片', q: 'a & b', sort: 'size_desc', page: '2', page_size: '20' });
});
