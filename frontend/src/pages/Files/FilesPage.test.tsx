import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FilesPage from './FilesPage';
import { deleteFile, getDiskInfo, getFilePreview, listFiles, type FileListResponse } from '@/services/files';
import { DISK_REFRESH_INTERVAL_MS, FILES_REFRESH_INTERVAL_MS } from '@/config/files';

vi.mock('@/services/files', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/files')>(),
  listFiles: vi.fn(), deleteFile: vi.fn(), getFilePreview: vi.fn(), getDiskInfo: vi.fn(),
}));

const makeData = (): FileListResponse => ({
  files: Array.from({ length: 21 }, (_, index) => ({
    name: `文件 ${String(index + 1).padStart(2, '0')}.txt`, size: index + 1,
    size_display: `${index + 1} B`, mtime: '2026-10-23 12:00:00',
  })),
  total_size_display: '231 B', disk_free_display: '10 GB',
  disk_used_display: '90 GB', disk_total_display: '100 GB', disk_pct: 90, disk_pct_warning: true,
});

const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
beforeEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.mocked(listFiles).mockResolvedValue(makeData());
  vi.mocked(getDiskInfo).mockResolvedValue(makeData());
  vi.mocked(deleteFile).mockResolvedValue({ status: 'deleted' });
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'preview', version: 'v1' });
});
afterEach(() => {
  cleanup(); vi.clearAllMocks(); vi.useRealTimers();
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
});
const openPage = () => render(createElement(RouterProvider, { router: createMemoryRouter([{ path: '*', element: createElement(FilesPage) }]) }));

const advancePoll = (milliseconds = FILES_REFRESH_INTERVAL_MS) =>
  act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });

async function openPollingPage() {
  vi.useFakeTimers();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = openPage(); });
  return view;
}

it('keeps all files available after pagination, searching, and sorting', async () => {
  openPage();
  await screen.findByText('文件 01.txt');
  expect(screen.queryByText('文件 21.txt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('文件 21.txt')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '01' } });
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'size_desc' } });
  expect(screen.getAllByRole('row')[1].textContent).toContain('文件 21.txt');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
});

it('requires confirmation, encodes download paths, and clamps the page after deletion', async () => {
  const data = makeData();
  vi.mocked(listFiles).mockResolvedValueOnce(data).mockResolvedValue({ ...data, files: data.files.slice(0, 20) });
  openPage();
  await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByRole('link', { name: '下载 文件 21.txt' }).getAttribute('href')).toBe('/api/files/' + encodeURIComponent('文件 21.txt'));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 21.txt' }));
  expect(deleteFile).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 21.txt' }));
  await waitFor(() => expect(deleteFile).toHaveBeenCalledWith('文件 21.txt'));
  await screen.findByText('文件 01.txt');
  expect(screen.queryByText('文件 21.txt')).toBeNull();
  expect(screen.queryByRole('navigation', { name: '文件列表分页' })).toBeNull();
});

it('cancels inline confirmation without deleting and only confirms one file at a time', async () => {
  openPage();
  await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  expect(screen.getByRole('button', { name: '确认删除 文件 01.txt' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('button', { name: '删除 文件 01.txt' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 02.txt' }));
  expect(screen.getByRole('button', { name: '删除 文件 01.txt' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '确认删除 文件 02.txt' })).toBeTruthy();
  expect(deleteFile).not.toHaveBeenCalled();
});

it('shows load errors with a working retry and distinguishes empty search results', async () => {
  vi.mocked(listFiles).mockRejectedValueOnce(new Error('网络不可用'));
  openPage();
  expect((await screen.findByRole('alert')).textContent).toContain('网络不可用');
  fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
  await screen.findByText('文件 01.txt');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(screen.getByText('没有找到匹配的文件。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
});

it('keeps deletion confirmation after failure so the same action can be retried', async () => {
  vi.mocked(deleteFile).mockRejectedValueOnce(new Error('offline'));
  openPage();
  await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  await waitFor(() => expect(deleteFile).toHaveBeenCalledTimes(2));
});

it('sorts timezone-aware modification times by instant rather than their string order', async () => {
  const data = makeData();
  data.files = [
    { ...data.files[0], mtime: '2026-11-06T20:00:00+08:00' },
    { ...data.files[1], mtime: '2026-11-06T13:00:00Z' },
  ];
  vi.mocked(listFiles).mockResolvedValue(data);
  openPage();
  await screen.findByText('文件 01.txt');
  expect(screen.getAllByRole('row')[1].textContent).toContain('文件 02.txt');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mtime_asc' } });
  expect(screen.getAllByRole('row')[1].textContent).toContain('文件 01.txt');
});

it('updates files and storage silently, keeps search/sort/page, clamps deleted pages, and stops on unmount', async () => {
  const view = await openPollingPage();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '文件' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'name_asc' } });
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  const data = makeData();
  const added = { ...data.files[20], name: '文件 22.txt' };
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: [...data.files, added], disk_pct: 42, disk_free_display: '58 GB' });
  vi.mocked(getDiskInfo).mockResolvedValue({ ...data, disk_pct: 42, disk_free_display: '58 GB' });
  await advancePoll();
  expect(screen.getByText('文件 22.txt')).toBeTruthy();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('文件');
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('name_asc');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
  await advancePoll(DISK_REFRESH_INTERVAL_MS - FILES_REFRESH_INTERVAL_MS);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
  expect(screen.getByText('58 GB')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '加载中…' })).toBeNull();
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: data.files.slice(0, 20) });
  await advancePoll();
  expect(screen.queryByText('文件 22.txt')).toBeNull();
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
  const calls = vi.mocked(listFiles).mock.calls.length;
  view.unmount();
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(calls);
});

it.each(['confirmation', 'preview'])('cancels stale polling and pauses during %s, then resumes', async kind => {
  await openPollingPage();
  let finish!: (value: FileListResponse) => void;
  vi.mocked(listFiles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  const signal = vi.mocked(listFiles).mock.calls[1][0];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: kind === 'preview' ? '预览 文件 01.txt' : '删除 文件 01.txt' })); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ ...makeData(), files: [] }); });
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(2);
  expect(screen.getByText('文件 01.txt', { selector: 'td' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: kind === 'preview' ? '关闭' : '取消' }));
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(3);
});

it('waits for a slow poll to finish before scheduling another request', async () => {
  await openPollingPage();
  let finish!: (value: FileListResponse) => void;
  vi.mocked(listFiles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 4);
  expect(listFiles).toHaveBeenCalledTimes(2);
  await act(async () => { finish(makeData()); });
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(3);
});

it('pauses for the whole deletion request and resumes after the foreground resync', async () => {
  await openPollingPage();
  let finish!: (value: { status: string }) => void;
  vi.mocked(deleteFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(1);
  const data = makeData();
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: data.files.slice(1) });
  await act(async () => { finish({ status: 'deleted' }); });
  expect(listFiles).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('文件 01.txt')).toBeNull();
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(3);
});

it('keeps content and deletion errors when a poll fails and recovers on the next poll', async () => {
  await openPollingPage();
  vi.mocked(deleteFile).mockRejectedValueOnce(new Error('delete failed'));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' })); });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  vi.mocked(listFiles).mockRejectedValueOnce(new Error('offline'));
  await advancePoll();
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('delete failed');
  expect(screen.getByText(/自动更新暂不可用/)).toBeTruthy();
  await advancePoll();
  expect(screen.queryByText(/自动更新暂不可用/)).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('delete failed');
});

it('cancels requests while hidden and refreshes immediately when visible', async () => {
  await openPollingPage();
  let finish!: (value: FileListResponse) => void;
  vi.mocked(listFiles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  const signal = vi.mocked(listFiles).mock.calls[1][0];
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
  expect(signal?.aborted).toBe(true);
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => { fireEvent(document, new Event('visibilitychange')); });
  expect(listFiles).toHaveBeenCalledTimes(3);
  await act(async () => { finish({ ...makeData(), files: [] }); });
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
});

it('does not replace selected text during a background update', async () => {
  await openPollingPage();
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.selectNodeContents(screen.getByText('文件 01.txt'));
  selection.addRange(range);
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(1);
  selection.removeAllRanges();
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(2);
});

it('keeps the accepted list on 304 and makes manual refresh unconditional', async () => {
  vi.mocked(listFiles).mockResolvedValueOnce({ ...makeData(), etag: '"v1"' }).mockResolvedValue({ notModified: true, etag: '"v1"' });
  await openPollingPage();
  const first = screen.getByText('文件 01.txt');
  await advancePoll();
  expect(vi.mocked(listFiles).mock.lastCall?.[1]).toBe('"v1"');
  expect(screen.getByText('文件 01.txt')).toBe(first);
  expect(getDiskInfo).toHaveBeenCalledTimes(1);
  vi.mocked(listFiles).mockResolvedValue({ ...makeData(), etag: '"v1"' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
  expect(vi.mocked(listFiles).mock.lastCall?.[1]).toBeUndefined();
  expect(getDiskInfo).toHaveBeenCalledTimes(2);
});

it('does not accept validators from aborted file-list responses', async () => {
  vi.mocked(listFiles).mockResolvedValue({ ...makeData(), etag: '"v1"' });
  await openPollingPage();
  let finish!: (value: FileListResponse & { etag: string }) => void;
  vi.mocked(listFiles).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  await act(async () => { finish({ ...makeData(), files: [], etag: '"aborted"' }); });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await advancePoll();
  expect(vi.mocked(listFiles).mock.lastCall?.[1]).toBe('"v1"');
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
});

it('invalidates the validator after deletion even if the immediate resync fails', async () => {
  vi.mocked(listFiles).mockResolvedValue({ ...makeData(), etag: '"v1"' });
  await openPollingPage();
  vi.mocked(listFiles).mockRejectedValueOnce(new Error('resync failed'));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' })); });
  expect(screen.queryByText('文件 01.txt')).toBeNull();
  vi.mocked(listFiles).mockResolvedValue({ ...makeData(), files: makeData().files.slice(1), etag: '"v2"' });
  await advancePoll();
  expect(vi.mocked(listFiles).mock.lastCall?.[1]).toBeUndefined();
  expect(screen.queryByText('文件 01.txt')).toBeNull();
});

it('refreshes disk state on its own interval while unchanged lists return 304', async () => {
  vi.mocked(listFiles).mockResolvedValueOnce({ ...makeData(), etag: '"v1"' }).mockResolvedValue({ notModified: true, etag: '"v1"' });
  await openPollingPage();
  const first = screen.getByText('文件 01.txt');
  vi.mocked(getDiskInfo).mockRejectedValueOnce(new Error('disk offline'));
  await advancePoll(DISK_REFRESH_INTERVAL_MS);
  expect(screen.getByText(/自动更新暂不可用/)).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
  vi.mocked(getDiskInfo).mockResolvedValue({ ...makeData(), disk_pct: 42 });
  await advancePoll(DISK_REFRESH_INTERVAL_MS);
  expect(screen.queryByText(/自动更新暂不可用/)).toBeNull();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
  expect(screen.getByText('文件 01.txt')).toBe(first);
  expect(vi.mocked(listFiles).mock.lastCall?.[1]).toBe('"v1"');
});

it('cancels disk polling during preview and rejects its stale response', async () => {
  await openPollingPage();
  let finish!: (value: FileListResponse) => void;
  vi.mocked(getDiskInfo).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll(DISK_REFRESH_INTERVAL_MS);
  const signal = vi.mocked(getDiskInfo).mock.calls[1][0];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览 文件 01.txt' })); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ ...makeData(), disk_pct: 42 }); });
  await advancePoll(DISK_REFRESH_INTERVAL_MS * 2);
  expect(getDiskInfo).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await advancePoll(DISK_REFRESH_INTERVAL_MS);
  expect(getDiskInfo).toHaveBeenCalledTimes(3);
});
