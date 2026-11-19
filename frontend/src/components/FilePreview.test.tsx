import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FilePreview } from './FilePreview';
import { getFilePreview, getTextSaveStatus, saveTextOperation } from '@/services/files';
import { AxiosError } from 'axios';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';

const renderPreview = (element: ReactNode) => render(<RouterProvider router={createMemoryRouter([{ path: '*', element }])} />);

vi.mock('@/services/files', async original => ({
  ...await original<typeof import('@/services/files')>(), getFilePreview: vi.fn(), saveTextOperation: vi.fn(), getTextSaveStatus: vi.fn(),
}));

it('saves edits with the preview version and updates the preview', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' }).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'new', version: 'v2' });
  vi.mocked(saveTextOperation).mockResolvedValue({ status: 'saved', version: 'v2' });
  const onSaved = vi.fn();
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox', { name: '文件内容' }), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('文件已保存');
  expect(saveTextOperation).toHaveBeenCalledWith('file.txt', expect.objectContaining({ text: 'new', version: 'v1', id: expect.any(String) }));
  expect(screen.getByText('new').tagName).toBe('PRE');
  expect(onSaved).toHaveBeenCalledOnce();
});

it('keeps drafts after conflicts and asks before discarding on escape or reload', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' })
    .mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'other device', version: 'v2' });
  const reason = new AxiosError('conflict');
  reason.response = { data: { code: 'TEXT_CONFLICT' }, status: 409, statusText: '', headers: {}, config: {} as never };
  vi.mocked(saveTextOperation).mockRejectedValue(reason);
  const onClose = vi.fn();
  renderPreview(<FilePreview name="file.txt" onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my draft' } });
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('group', { name: /有尚未保存的修改/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('文件已被其他操作修改');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my draft');
  fireEvent.click(screen.getByRole('button', { name: '重新加载文件' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await screen.findByText('other device');
  expect(screen.queryByRole('textbox')).toBeNull();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it('renders uploaded markup as text, keeps download available, and restores focus on close', async () => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: '<script>alert(1)</script>' });
  const trigger = document.createElement('button');
  document.body.append(trigger); trigger.focus();
  const onClose = vi.fn();
  const view = renderPreview(<FilePreview name="folder/代码.html" onClose={onClose} />);
  expect((await screen.findByText('<script>alert(1)</script>')).tagName).toBe('PRE');
  expect(view.container.querySelector('script')).toBeNull();
  expect(screen.getByRole('link', { name: '下载' }).getAttribute('href')).toBe('/api/files/' + encodeURIComponent('folder/代码.html'));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount(); expect(document.activeElement).toBe(trigger); trigger.remove();
});

it('reports unsupported previews and aborts pending requests when closed', async () => {
  vi.mocked(getFilePreview).mockRejectedValue(new Error('unsupported'));
  const view = renderPreview(<FilePreview name="sample.bin" onClose={vi.fn()} />);
  expect((await screen.findByRole('alert')).textContent).toContain('unsupported');
  const signal = vi.mocked(getFilePreview).mock.calls.at(-1)![1]!;
  view.unmount(); expect(signal.aborted).toBe(true);
});

it('streams media through the protected URL and handles unsupported browser codecs', async () => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'video', mime_type: 'video/mp4', text: '' });
  const onClose = vi.fn();
  const view = renderPreview(<FilePreview name="movie.mp4" onClose={onClose} />);
  await waitFor(() => expect(view.container.querySelector('video')).not.toBeNull());
  const video = view.container.querySelector('video')!;
  expect(video.getAttribute('src')).toBe('/api/files/movie.mp4?preview=1');
  fireEvent.error(video);
  expect((await screen.findByRole('alert')).textContent).toContain('无法预览');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('retains the immutable text operation after a lost response and retries it only when status is unknown', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' })
    .mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'new', version: 'v2' });
  vi.mocked(saveTextOperation).mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ status: 'saved', version: 'v2' });
  vi.mocked(getTextSaveStatus).mockResolvedValue({ status: 'unknown' });
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const confirm = await screen.findByRole('button', { name: '确认保存结果' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(confirm);
  await screen.findByText('文件已保存');
  expect(saveTextOperation).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveTextOperation).mock.calls[1]).toEqual(vi.mocked(saveTextOperation).mock.calls[0]);
  expect(getTextSaveStatus).toHaveBeenCalledTimes(2);
});

it('keeps a confirmed receipt when preview loading fails and then shows later edits without another write', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' })
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'later edit', version: 'v3' });
  vi.mocked(saveTextOperation).mockRejectedValueOnce(new Error('lost response'));
  vi.mocked(getTextSaveStatus).mockResolvedValueOnce({ status: 'saved', version: 'v2' });
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect((await screen.findByRole('alert')).textContent).toContain('文件已保存');
  fireEvent.click(screen.getByRole('button', { name: '确认保存结果' }));
  await screen.findByText('later edit');
  expect(screen.getByText(/文件随后又被修改/)).toBeTruthy();
  expect(saveTextOperation).toHaveBeenCalledOnce();
  expect(getTextSaveStatus).toHaveBeenCalledOnce();
});

it('retries a failed preview metadata request without closing the dialog', async () => {
  vi.mocked(getFilePreview).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'recovered', version: 'v1' });
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  expect(await screen.findByText('recovered')).toBeTruthy();
});

it.each([{ ctrlKey: true }, { metaKey: true }])('saves text using the platform shortcut and ignores repeated presses (%j)', async modifiers => {
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' });
  let finish!: (result: { status: 'saved'; version: string }) => void;
  vi.mocked(saveTextOperation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 's', ...modifiers });
  expect(saveTextOperation).not.toHaveBeenCalled(); // unchanged content
  fireEvent.change(input, { target: { value: 'shortcut draft' } });
  fireEvent.keyDown(input, { key: 's', ...modifiers });
  fireEvent.keyDown(input, { key: 's', ...modifiers, repeat: true });
  expect(saveTextOperation).toHaveBeenCalledOnce();
  expect(saveTextOperation).toHaveBeenCalledWith('file.txt', expect.objectContaining({ text: 'shortcut draft', version: 'v1' }));
  finish({ status: 'saved', version: 'v2' });
  await screen.findByText('文件已保存');
});

it('compares a conflict against the original and latest text while retaining the draft and version', async () => {
  vi.mocked(getFilePreview).mockResolvedValueOnce({ kind: 'text', mime_type: 'text/plain', text: 'original', version: 'v1' })
    .mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'latest remote', version: 'v2' });
  const conflict = new AxiosError('conflict');
  conflict.response = { data: { code: 'TEXT_CONFLICT' }, status: 409, statusText: '', headers: {}, config: {} as never };
  vi.mocked(saveTextOperation).mockRejectedValue(conflict);
  renderPreview(<FilePreview name="file.txt" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '<b>my draft</b>' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '对比最新内容' }));
  expect((await screen.findByText('latest remote')).tagName).toBe('PRE');
  expect(screen.getByText('original').tagName).toBe('PRE');
  expect(screen.getByText('<b>my draft</b>', { selector: 'pre' }).tagName).toBe('PRE');
  expect((input as HTMLTextAreaElement).value).toBe('<b>my draft</b>');
  fireEvent.keyDown(input, { key: 's', ctrlKey: true });
  expect(saveTextOperation).toHaveBeenCalledOnce(); // comparison never rebases or overwrites
  expect(vi.mocked(saveTextOperation).mock.calls[0][1].version).toBe('v1');
});
