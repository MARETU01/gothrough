import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppRoutes } from './router';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';
import { getDiskInfo, listFiles } from '@/services/files';
import { getClipboardImageSettings, listClipboard } from '@/services/clipboard';
import { changeLanguage } from '@/i18n';

vi.mock('@/services/upload', () => ({
  initUpload: vi.fn(), uploadChunk: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
}));
vi.mock('@/services/files', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/files')>(), listFiles: vi.fn(), getDiskInfo: vi.fn(),
}));
vi.mock('@/services/clipboard', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/clipboard')>(),
  listClipboard: vi.fn(), getClipboardImageSettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(initUpload).mockResolvedValue({ session_id: 'test', total_chunks: 1, chunk_size: 5, final_filename: 'test.txt' });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'test.txt' });
  vi.mocked(cancelUpload).mockResolvedValue({ status: 'cancelled' });
  vi.mocked(listFiles).mockResolvedValue({ files: [], total_size_display: '0 B', disk_free_display: '1 GB', disk_used_display: '0 B', disk_total_display: '1 GB', disk_pct: 0, disk_pct_warning: false });
  vi.mocked(getDiskInfo).mockResolvedValue({ disk_free_display: '1 GB', disk_used_display: '0 B', disk_total_display: '1 GB', disk_pct: 0, disk_pct_warning: false });
  vi.mocked(listClipboard).mockResolvedValue({ entries: [] });
  vi.mocked(getClipboardImageSettings).mockResolvedValue({ enabled: false, max_size_mb: 10, max_pixels: 20000000, max_total_size_mb: 200 });
});
afterEach(cleanup);

function openApp(path = '/') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}>
    <UploadQueueProvider><AppRoutes /></UploadQueueProvider>
  </MemoryRouter></StrictMode>);
}

it('keeps a transfer running while navigating between lazy pages', async () => {
  let finish!: (value: { received: number }) => void;
  vi.mocked(uploadChunk).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  openApp();
  expect(screen.getByRole('heading', { name: 'GoThrough' })).toBeTruthy();
  expect(listFiles).not.toHaveBeenCalled();
  expect(listClipboard).not.toHaveBeenCalled();

  fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: '文件上传' }));
  await screen.findByRole('heading', { name: '文件上传', level: 1 }, { timeout: 5000 });
  fireEvent.change(screen.getByLabelText('上传文件'), { target: { files: [new File(['hello'], 'test.txt')] } });
  fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
  await waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(uploadChunk).mock.calls[0][0].signal;

  fireEvent.click(screen.getByRole('link', { name: '文件列表' }));
  await screen.findByRole('heading', { name: '已上传文件' }, { timeout: 5000 });
  await screen.findByText('1 GB');
  expect(getDiskInfo).toHaveBeenCalled();
  expect(signal?.aborted).toBe(false);
  expect(cancelUpload).not.toHaveBeenCalled();
  await act(async () => { finish({ received: 1 }); });
  await waitFor(() => expect(completeUpload).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('link', { name: '文件上传' }));
  await screen.findByText('上传成功');
  expect(initUpload).toHaveBeenCalledTimes(1);
});

it('loads a lazy page directly and keeps language switching available', async () => {
  openApp('/clipboard');
  expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '界面语言' }), { target: { value: 'en' } });
  await screen.findByRole('heading', { name: 'Shared clipboard' }, { timeout: 5000 });
  expect(document.title).toBe('Shared clipboard - GoThrough');
  expect(await screen.findByText('Nothing shared yet. Publish your first text.')).toBeTruthy();
});

it('localizes the unknown-route page', async () => {
  await changeLanguage('en');
  openApp('/missing');
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
});
