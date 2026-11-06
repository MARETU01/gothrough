import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilePreview } from './FilePreview';
import { getFilePreview, saveFileText } from '@/services/files';
import { AxiosError } from 'axios';

vi.mock('@/services/files', async original => ({
  ...await original<typeof import('@/services/files')>(), getFilePreview: vi.fn(), saveFileText: vi.fn(),
}));

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});

it('saves edits with the preview version and updates the preview', async () => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' });
  vi.mocked(saveFileText).mockResolvedValue({ version: 'v2' });
  const onSaved = vi.fn();
  render(<FilePreview name="file.txt" onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox', { name: '文件内容' }), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('文件已保存');
  expect(saveFileText).toHaveBeenCalledWith('file.txt', 'new', 'v1');
  expect(screen.getByText('new').tagName).toBe('PRE');
  expect(onSaved).toHaveBeenCalledOnce();
});

it('keeps drafts after conflicts and asks before discarding on escape or reload', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' })
    .mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'other device', version: 'v2' });
  const reason = new AxiosError('conflict');
  reason.response = { data: { code: 'TEXT_CONFLICT' }, status: 409, statusText: '', headers: {}, config: {} as never };
  vi.mocked(saveFileText).mockRejectedValue(reason);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onClose = vi.fn();
  render(<FilePreview name="file.txt" onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my draft' } });
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('文件已被其他操作修改');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my draft');
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载文件' }));
  await screen.findByText('other device');
  expect(screen.queryByRole('textbox')).toBeNull();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it('renders uploaded markup as text, keeps download available, and restores focus on close', async () => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: '<script>alert(1)</script>' });
  const trigger = document.createElement('button');
  document.body.append(trigger); trigger.focus();
  const onClose = vi.fn();
  const view = render(<FilePreview name="folder/代码.html" onClose={onClose} />);
  expect((await screen.findByText('<script>alert(1)</script>')).tagName).toBe('PRE');
  expect(view.container.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: '下载' }).getAttribute('href')).toBe('/api/files/' + encodeURIComponent('folder/代码.html'));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it('reports unsupported previews and aborts pending requests when closed', async () => {
  vi.mocked(getFilePreview).mockRejectedValue(new Error('unsupported'));
  const view = render(<FilePreview name="sample.bin" onClose={vi.fn()} />);
  expect((await screen.findByRole('alert')).textContent).toBe('unsupported');
  const signal = vi.mocked(getFilePreview).mock.calls.at(-1)![1]!;
  view.unmount(); expect(signal.aborted).toBe(true);
});

it('streams media through the protected URL and handles unsupported browser codecs', async () => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'video', mime_type: 'video/mp4', text: '' });
  const onClose = vi.fn();
  const view = render(<FilePreview name="movie.mp4" onClose={onClose} />);
  await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
  const video = view.container.querySelector('video')!;
  expect(video.getAttribute('src')).toBe('/api/files/movie.mp4?preview=1');
  fireEvent.error(video);
  expect((await screen.findByRole('alert')).textContent).toContain('无法预览');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});
