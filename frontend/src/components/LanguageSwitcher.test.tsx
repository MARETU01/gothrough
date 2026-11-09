import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadQueueProvider } from '@/contexts/UploadQueueProvider';
import { Navigation } from '@/layouts/Navigation';
import UploadPage from '@/pages/Upload/UploadPage';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';
import * as language from '@/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

vi.mock('@/services/upload', () => ({
  initUpload: vi.fn(), uploadChunk: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(initUpload).mockResolvedValue({ session_id: 'test', total_chunks: 1, chunk_size: 5, final_filename: 'test.txt' });
  vi.mocked(completeUpload).mockResolvedValue({ status: 'success', saved_filename: 'test.txt' });
  vi.mocked(cancelUpload).mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

it('switches language during a transfer without restarting or aborting the upload', async () => {
  let finish!: (result: { received: number }) => void;
  vi.mocked(uploadChunk).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><UploadQueueProvider><Navigation /><UploadPage /></UploadQueueProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('上传文件'), { target: { files: [new File(['hello'], 'test.txt')] } });
  fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
  await waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(uploadChunk).mock.calls[0][0].signal;

  fireEvent.change(screen.getByRole('combobox', { name: '界面语言' }), { target: { value: 'en' } });
  expect(await screen.findByRole('button', { name: 'Pause all' })).toBeTruthy();
  expect(screen.getByText('Uploading')).toBeTruthy();
  expect(document.title).toBe('Upload files - GoThrough');
  expect(document.documentElement.lang).toBe('en');
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  expect(signal?.aborted).toBe(false);
  expect(cancelUpload).not.toHaveBeenCalled();
  expect(initUpload).toHaveBeenCalledTimes(1);

  await act(async () => { finish({ received: 1 }); });
  await screen.findByText('Uploaded');
  fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), { target: { value: 'zh-CN' } });
  expect(await screen.findByText('上传成功')).toBeTruthy();
  expect(completeUpload).toHaveBeenCalledTimes(1);
});

it('retranslates stored upload errors, keeping filenames intact', async () => {
  vi.mocked(initUpload).mockRejectedValue({ isAxiosError: true, response: { data: { code: 'SERVER_BUSY', error: '服务器上传繁忙，请稍后重试' } } });
  render(<MemoryRouter><UploadQueueProvider><Navigation /><UploadPage /></UploadQueueProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('上传文件'), { target: { files: [new File(['hello'], '中文.txt')] } });
  fireEvent.click(screen.getByRole('button', { name: '开始上传' }));
  await screen.findByText('服务器上传繁忙，请稍后重试');
  fireEvent.change(screen.getByRole('combobox', { name: '界面语言' }), { target: { value: 'en' } });
  expect(await screen.findByText('The upload server is busy. Please try again later.')).toBeTruthy();
  expect(screen.getByText('Upload failed: 中文.txt - The upload server is busy. Please try again later.')).toBeTruthy();
  expect(screen.getByText('中文.txt')).toBeTruthy();
});

it('keeps the current language and preference when loading another language fails', async () => {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  vi.spyOn(language, 'changeLanguage').mockRejectedValueOnce(new Error('offline'));
  render(<LanguageSwitcher />);
  fireEvent.change(screen.getByRole('combobox', { name: '界面语言' }), { target: { value: 'en' } });
  expect((await screen.findByRole('alert')).textContent).toBe('语言加载失败，请刷新页面后重试。');
  expect(language.default.resolvedLanguage).toBe('zh-CN');
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(saved);
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
});
