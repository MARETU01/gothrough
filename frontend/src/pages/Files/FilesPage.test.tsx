import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FilesPage from './FilesPage';
import { deleteFile, listFiles, type FileListResponse } from '@/services/files';

vi.mock('@/services/files', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/files')>(),
  listFiles: vi.fn(), deleteFile: vi.fn(),
}));

const makeData = (): FileListResponse => ({
  files: Array.from({ length: 21 }, (_, index) => ({
    name: `文件 ${String(index + 1).padStart(2, '0')}.txt`, size: index + 1,
    size_display: `${index + 1} B`, mtime: '2026-10-23 12:00:00',
  })),
  total_size_display: '231 B', disk_free_display: '10 GB',
  disk_used_display: '90 GB', disk_total_display: '100 GB', disk_pct: 90, disk_pct_warning: true,
});

beforeEach(() => { vi.mocked(listFiles).mockResolvedValue(makeData()); vi.mocked(deleteFile).mockResolvedValue({ status: 'deleted' }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const openPage = () => render(createElement(MemoryRouter, null, createElement(FilesPage)));

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
  expect(screen.getByRole('link', { name: '下载 文件 21.txt' }).getAttribute('href')).toBe('/api/uploads/' + encodeURIComponent('文件 21.txt'));
  fireEvent.click(screen.getByRole('button', { name: '删除 文件 21.txt' }));
  expect(deleteFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认删除 文件 21.txt' }));
  await waitFor(() => expect(deleteFile).toHaveBeenCalledWith('文件 21.txt'));
  await screen.findByText('文件 01.txt');
  expect(screen.queryByText('文件 21.txt')).toBeNull();
  expect(screen.queryByRole('navigation', { name: '文件列表分页' })).toBeNull();
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
