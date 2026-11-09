import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FilesPage from './FilesPage';
import { deleteSelection, getDiskInfo, getFilePreview, listFiles, type FileListResponse } from '@/services/files';
import { DISK_REFRESH_INTERVAL_MS, FILES_REFRESH_INTERVAL_MS } from '@/config/files';

vi.mock('@/services/files', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/files')>(),
  listFiles: vi.fn(), deleteSelection: vi.fn(), getFilePreview: vi.fn(), getDiskInfo: vi.fn(),
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
  vi.mocked(deleteSelection).mockImplementation(async entries => ({ results: entries.map(entry => ({ path: entry.path, deleted: true })) }));
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'preview', version: 'v1' });
});
afterEach(() => {
  cleanup(); vi.clearAllMocks(); vi.useRealTimers();
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
});
const openPage = (initialEntries = ['/files']) => {
  const router = createMemoryRouter([{ path: '*', element: createElement(FilesPage) }], { initialEntries });
  return { ...render(createElement(RouterProvider, { router })), router };
};

const advancePoll = (milliseconds = FILES_REFRESH_INTERVAL_MS) =>
  act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });

it('selects only the current page and clears selection on pagination, sorting, and search', async () => {
  openPage();
  await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('checkbox', { name: '全选当前页' }));
  expect(screen.getByText('已选 20 项')).toBeTruthy();
  const download = screen.getByRole('link', { name: '下载 ZIP' });
  const paths = new URL(download.getAttribute('href')!, 'http://localhost').searchParams.getAll('path');
  expect(paths).toHaveLength(20);
  expect(paths).not.toContain('文件 21.txt');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('已选 0 项')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 21.txt' }));
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '文件排序' }), { target: { value: 'name_asc' } });
  expect(screen.getByText('已选 0 项')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 01.txt' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '01' } });
  expect(screen.getByText('已选 0 项')).toBeTruthy();
});

it('confirms deletion, restores focus on cancel, and retains only failed items for retry', async () => {
  const data = makeData();
  openPage(); await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 01.txt' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 02.txt' }));
  const trigger = screen.getByRole('button', { name: '删除所选' });
  fireEvent.click(trigger);
  expect(deleteSelection).not.toHaveBeenCalled();
  expect(screen.getByRole('group', { name: '确认删除所选的 2 项？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(document.activeElement).toBe(trigger);
  vi.mocked(deleteSelection).mockResolvedValueOnce({ results: [
    { path: '文件 01.txt', deleted: true }, { path: '文件 02.txt', deleted: false, code: 'STORAGE_PERMISSION', error: 'private fallback' },
  ] });
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: data.files.slice(1) });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await screen.findByText('已删除 1 项');
  expect(deleteSelection).toHaveBeenCalledWith([{ path: '文件 01.txt', folder: false }, { path: '文件 02.txt', folder: false }]);
  expect(screen.queryByRole('checkbox', { name: '选择 文件 01.txt' })).toBeNull();
  expect((screen.getByRole('checkbox', { name: '选择 文件 02.txt' }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('1 项删除失败');
  expect(screen.queryByText('private fallback')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '删除所选' })));
});

it('includes folder contents in confirmed bulk deletion and resets selection through history', async () => {
  const data = { ...makeData(), files: [{ ...makeData().files[0], name: 'doc/file.txt' }] };
  vi.mocked(listFiles).mockResolvedValue(data);
  const view = openPage();
  await screen.findByRole('button', { name: '打开文件夹 doc' });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 doc' }));
  fireEvent.click(screen.getByRole('button', { name: '打开文件夹 doc' }));
  expect(screen.getByText('已选 0 项')).toBeTruthy();
  await act(async () => { await view.router.navigate(-1); });
  expect(screen.getByText('已选 0 项')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 doc' }));
  vi.mocked(deleteSelection).mockResolvedValueOnce({ results: [{ path: 'doc', deleted: true }] });
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: [] });
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  expect(screen.getByText(/所选文件夹及其全部内容/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await screen.findByText('已删除 1 项');
  expect(deleteSelection).toHaveBeenCalledWith([{ path: 'doc', folder: true }]);
});

it('pauses polling while selecting and resumes after clearing the selection', async () => {
  await openPollingPage();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 01.txt' }));
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(2);
});

it('keeps the selection after transport failure and blocks duplicate mutations while deleting', async () => {
  openPage(); await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 01.txt' }));
  let reject!: (error: Error) => void;
  vi.mocked(deleteSelection).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('checkbox', { name: '全选当前页' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '处理中…' }));
  expect(deleteSelection).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('network disconnected')); });
  expect(screen.getByRole('alert').textContent).toContain('network disconnected');
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: '选择 文件 01.txt' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(false);
});

it('does not mark the current page selected when a retained failed item has disappeared', async () => {
  const data = { ...makeData(), files: makeData().files.slice(0, 2) };
  vi.mocked(listFiles).mockResolvedValue(data);
  openPage(); await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 文件 01.txt' }));
  vi.mocked(deleteSelection).mockResolvedValueOnce({ results: [{ path: '文件 01.txt', deleted: false, code: 'FILE_INACCESSIBLE' }] });
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: data.files.slice(1) });
  fireEvent.click(screen.getByRole('button', { name: '删除所选' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: '选择 文件 01.txt' })).toBeNull());
  expect(screen.getByText('已选 1 项')).toBeTruthy();
  const all = screen.getByRole('checkbox', { name: '全选当前页' }) as HTMLInputElement;
  expect(all.checked).toBe(false);
  fireEvent.click(all);
  expect((screen.getByRole('checkbox', { name: '选择 文件 02.txt' }) as HTMLInputElement).checked).toBe(true);
  expect(new URL(screen.getByRole('link', { name: '下载 ZIP' }).getAttribute('href')!, 'http://localhost').searchParams.getAll('path')).toEqual(['文件 02.txt']);
});

it('renders server pages without paginating them again and requests the selected query', async () => {
  const file = { name: 'doc/result.txt', label: 'result.txt', folder: false, size: 1, size_display: '1 B', mtime: '2026-11-06T13:00:00Z' };
  vi.mocked(listFiles).mockResolvedValue({ files: [file], total_size_display: '25 B', directory: 'doc', total: 25,
    total_files: 25, folder_count: 0, page: 2, page_size: 20, total_pages: 2 });
  openPage(['/files?dir=doc']);
  await screen.findByText('result.txt');
  expect(screen.getByText('第 2 / 2 页')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined,
    expect.objectContaining({ directory: 'doc', page: 1 })));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'result' } });
  await waitFor(() => expect(listFiles).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined,
    expect.objectContaining({ directory: 'doc', search: 'result', page: 1 })));
});

it('offers encoded ZIP downloads for folders and nested folders without duplicates', async () => {
  const data = makeData();
  data.files = ['照片/旅行/a.txt', '照片/旅行/b.txt', 'root.txt'].map(name => ({
    name, size: 1, size_display: '1 B', mtime: '2026-10-23T12:00:00Z',
  }));
  vi.mocked(listFiles).mockResolvedValue(data);
  openPage();
  const folder = await screen.findByRole('link', { name: '下载文件夹 照片' });
  expect(new URL(folder.getAttribute('href')!, 'http://localhost').pathname).toBe('/api/batch-download');
  expect(new URL(folder.getAttribute('href')!, 'http://localhost').searchParams.getAll('path')).toEqual(['照片']);
  expect(screen.queryByText('a.txt')).toBeNull();
  expect(screen.queryByRole('link', { name: '下载文件夹 照片/旅行' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开文件夹 照片' }));
  expect(screen.getAllByRole('link', { name: '下载文件夹 照片/旅行' })).toHaveLength(1);
  const nested = new URL(screen.getByRole('link', { name: '下载文件夹 照片/旅行' }).getAttribute('href')!, 'http://localhost');
  expect(nested.pathname).toBe('/api/batch-download');
  expect(nested.searchParams.getAll('path')).toEqual(['照片/旅行']);
  fireEvent.click(screen.getByRole('button', { name: '打开文件夹 照片/旅行' }));
  expect(screen.getByText('a.txt')).toBeTruthy();
  expect(screen.getByText('b.txt')).toBeTruthy();
  expect(screen.queryByText('root.txt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
  expect(screen.getByRole('button', { name: '打开文件夹 照片/旅行' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'root' } });
  expect(screen.getByText('root.txt')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '下载文件夹 照片' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a.txt' } });
  expect(screen.getByText('照片/旅行/a.txt')).toBeTruthy();
  expect(screen.getByRole('link', { name: '下载 照片/旅行/a.txt' }).getAttribute('href')).toBe('/api/files/' + encodeURIComponent('照片/旅行/a.txt'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: '打开文件夹 照片/旅行' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全部文件' }));
  expect(screen.getByText('root.txt')).toBeTruthy();
});

it('paginates the current directory, keeps folders first, and restores paths through browser history', async () => {
  const data = makeData();
  data.files = [...data.files.map(file => ({ ...file, name: 'doc/' + file.name })), { ...data.files[0], name: 'root.txt' }];
  vi.mocked(listFiles).mockResolvedValue(data);
  const view = openPage();
  await screen.findByRole('button', { name: '打开文件夹 doc' });
  expect(screen.getAllByRole('row')[1].textContent).toContain('doc');
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '打开文件夹 doc' }));
  expect(view.router.state.location.search).toBe('?dir=doc');
  expect(screen.getByText('文件 01.txt')).toBeTruthy();
  expect(screen.queryByText('root.txt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('文件 21.txt')).toBeTruthy();
  await act(async () => { await view.router.navigate(-1); });
  expect(screen.getByText('root.txt')).toBeTruthy();
  await act(async () => { await view.router.navigate(1); });
  expect(screen.getByRole('button', { name: 'doc' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('root.txt')).toBeNull();
});

it('opens a linked folder and returns to its surviving parent when its last file is deleted', async () => {
  const data = makeData();
  const keep = { ...data.files[0], name: 'doc/keep.txt' };
  data.files = [keep, { ...data.files[0], name: 'doc/sub/last.txt' }];
  vi.mocked(listFiles).mockResolvedValueOnce(data).mockResolvedValue({ ...data, files: [keep] });
  openPage(['/files?dir=doc%2Fsub']);
  await screen.findByText('last.txt');
  expect(screen.queryByText('keep.txt')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '删除 doc/sub/last.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 doc/sub/last.txt' }));
  await screen.findByText('keep.txt');
  expect(deleteSelection).toHaveBeenCalledWith([{ path: 'doc/sub/last.txt', folder: false }]);
  expect(screen.getByRole('button', { name: 'doc' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('last.txt')).toBeNull();
});

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
  expect(deleteSelection).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 21.txt' }));
  await waitFor(() => expect(deleteSelection).toHaveBeenCalledWith([{ path: '文件 21.txt', folder: false }]));
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
  expect(deleteSelection).not.toHaveBeenCalled();
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
  vi.mocked(deleteSelection).mockRejectedValueOnce(new Error('offline'));
  openPage();
  await screen.findByText('文件 01.txt');
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  await waitFor(() => expect(deleteSelection).toHaveBeenCalledTimes(2));
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
  // Query changes now trigger foreground requests; settle them before polling.
  await act(async () => {});
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
  expect(screen.getByRole('cell', { name: '文件 01.txt' })).toBeTruthy();
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
  let finish!: (value: { results: { path: string; deleted: boolean }[] }) => void;
  vi.mocked(deleteSelection).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
  await advancePoll(FILES_REFRESH_INTERVAL_MS * 3);
  expect(listFiles).toHaveBeenCalledTimes(1);
  const data = makeData();
  vi.mocked(listFiles).mockResolvedValue({ ...data, files: data.files.slice(1) });
  await act(async () => { finish({ results: [{ path: '文件 01.txt', deleted: true }] }); });
  expect(listFiles).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('文件 01.txt')).toBeNull();
  await advancePoll();
  expect(listFiles).toHaveBeenCalledTimes(3);
});

it('keeps content and deletion errors when a poll fails and recovers on the next poll', async () => {
  await openPollingPage();
  vi.mocked(deleteSelection).mockRejectedValueOnce(new Error('delete failed'));
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

for (const results of [
  [{ path: '文件 01.txt', deleted: false, code: 'STORAGE_PERMISSION', error: 'private fallback' }],
  [],
  [{ path: 'wrong.txt', deleted: true }],
]) {
  it('keeps a single file when its batch response does not confirm deletion: ' + JSON.stringify(results), async () => {
    vi.mocked(deleteSelection).mockResolvedValueOnce({ results });
    openPage();
    await screen.findByText('文件 01.txt');
    fireEvent.click(screen.getByRole('button', { name: '删除 文件 01.txt' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 01.txt' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('删除');
    expect(alert.textContent).not.toContain('private fallback');
    expect(screen.getByText('文件 01.txt')).toBeTruthy();
    expect(screen.queryByText('已删除 文件 01.txt')).toBeNull();
    expect(deleteSelection).toHaveBeenCalledWith([{ path: '文件 01.txt', folder: false }]);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });
}
