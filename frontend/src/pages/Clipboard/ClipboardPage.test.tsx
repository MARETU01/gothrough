import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClipboardPage from './ClipboardPage';
import { CLIPBOARD_MAX_BYTES, createClipboard, createClipboardImage, fetchClipboardImage, getClipboardImageSettings, deleteClipboard, clearClipboard, listClipboard, type ClipboardEntry } from '@/services/clipboard';
import { CLIPBOARD_REFRESH_INTERVAL_MS } from '@/config/clipboard';

vi.mock('@/services/clipboard', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/clipboard')>(),
  listClipboard: vi.fn(), createClipboard: vi.fn(), deleteClipboard: vi.fn(), clearClipboard: vi.fn(),
  getClipboardImageSettings: vi.fn(), createClipboardImage: vi.fn(), fetchClipboardImage: vi.fn(),
}));

const record = (text = '第一行\n<script>alert(1)</script>', id = 'entry-1'): ClipboardEntry => ({
  id, text, created_at: '2026-11-05T12:00:00Z',
});
const imageRecord = (): ClipboardEntry => ({ id: 'image-1', text: '', type: 'image', created_at: '2026-11-05T12:00:00Z',
  image: { url: '/api/clipboard/image-1/image', mime_type: 'image/png', size: 123, width: 2, height: 2 } });
let history: ClipboardEntry[];
const writeText = vi.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

beforeEach(() => {
  vi.mocked(getClipboardImageSettings).mockResolvedValue({ enabled: true, max_size_mb: 10, max_pixels: 20000000, max_total_size_mb: 200 });
  history = [];
  window.getSelection()?.removeAllRanges();
  vi.mocked(clearClipboard).mockImplementation(async () => {
    history = [];
    return { status: 'deleted' };
  });
  vi.mocked(listClipboard).mockImplementation(async (_, etag) => {
    const current = JSON.stringify(history);
    return etag === current ? { notModified: true, etag: current } : { entries: [...history], etag: current };
  });
  vi.mocked(createClipboard).mockImplementation(async text => {
    const entry = record(text);
    history.unshift(entry);
    return entry;
  });
  vi.mocked(deleteClipboard).mockImplementation(async id => {
    history = history.filter(entry => entry.id !== id);
    return { status: 'deleted' };
  });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:preview');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
});

it('publishes literal multiline text, refreshes history, and copies it', async () => {
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  const text = '  中文\n<script>alert(1)</script>\t ';
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  await screen.findByRole('article', { name: '记录 1' });
  expect(createClipboard).toHaveBeenCalledWith(text);
  expect(screen.getByLabelText('输入或粘贴文本').getAttribute('disabled')).toBeNull();
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('');
  expect(document.querySelector('.clipboard-entry pre')?.textContent).toBe(text);
  expect(document.querySelector('.clipboard-entry script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '复制记录 1' }));
  await screen.findByText('已复制到剪贴板。');
  expect(writeText).toHaveBeenCalledWith(text);
  history = [record('来自另一台设备', 'remote')];
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByText('来自另一台设备');
});

it('previews and publishes a selected image without changing the text draft, releasing the preview', async () => {
  const file = new File(['png'], 'screenshot.png', { type: 'image/png' });
  vi.mocked(createClipboardImage).mockImplementation(async () => { const entry = imageRecord(); history = [entry]; return entry; });
  const view = render(createElement(ClipboardPage));
  const input = await screen.findByLabelText(/选择图片，或/);
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: 'text draft' } });
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByAltText('待发布图片预览').getAttribute('src')).toBe('blob:preview');
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  await screen.findByText('图片已发布。');
  await waitFor(() => expect(screen.queryByAltText('待发布图片预览')).toBeNull());
  expect(createClipboardImage).toHaveBeenCalledWith(file);
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('text draft');
  expect(screen.getByAltText('共享图片 1').getAttribute('src')).toBe('/api/clipboard/image-1/image');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  view.unmount();
});

it('accepts pasted screenshots and keeps the image draft after publication fails', async () => {
  render(createElement(ClipboardPage));
  await waitFor(() => expect((screen.getByLabelText(/选择图片，或/) as HTMLInputElement).disabled).toBe(false));
  const file = new File(['png'], 'pasted.png', { type: 'image/png' });
  fireEvent.paste(screen.getByLabelText('输入或粘贴文本'), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } });
  expect(screen.getByAltText('待发布图片预览')).toBeTruthy();
  vi.mocked(createClipboardImage).mockRejectedValueOnce(new Error('upload failed'));
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  expect((await screen.findByRole('alert')).textContent).toContain('upload failed');
  expect(screen.getByAltText('待发布图片预览')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移除图片' }));
  expect(screen.queryByAltText('待发布图片预览')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('writes a PNG image to the clipboard during the click gesture', async () => {
  history = [imageRecord()];
  const blob = new Blob(['png'], { type: 'image/png' });
  vi.mocked(fetchClipboardImage).mockResolvedValue(blob);
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  const clipboardItem = vi.fn(class {
    data: Record<string, Promise<Blob>>;
    constructor(data: Record<string, Promise<Blob>>) { this.data = data; }
  });
  vi.stubGlobal('ClipboardItem', clipboardItem);
  render(createElement(ClipboardPage));
  await screen.findByAltText('共享图片 1');
  fireEvent.click(screen.getByRole('button', { name: '复制记录 1' }));
  expect(write).toHaveBeenCalledOnce();
  expect(fetchClipboardImage).toHaveBeenCalledWith('image-1');
  await expect(clipboardItem.mock.calls[0][0]['image/png']).resolves.toBe(blob);
  await screen.findByText('已复制到剪贴板。');
  expect(writeText).not.toHaveBeenCalled();
});

it('offers image download and manual copy when clipboard permission is denied', async () => {
  history = [imageRecord()];
  vi.stubGlobal('ClipboardItem', class {});
  vi.mocked(fetchClipboardImage).mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn().mockRejectedValue(new Error('denied')) } });
  render(createElement(ClipboardPage));
  await screen.findByAltText('共享图片 1');
  fireEvent.click(screen.getByRole('button', { name: '复制记录 1' }));
  await screen.findByText(/无法直接复制图片/);
  expect(screen.getByRole('link', { name: '打开图片' }).getAttribute('href')).toBe('/api/clipboard/image-1/image');
  expect(screen.getAllByRole('link', { name: '下载图片' })[0].getAttribute('href')).toBe('/api/clipboard/image-1/image?download=1');
});

it('uses server image limits and rejects unsupported local files', async () => {
  vi.mocked(getClipboardImageSettings).mockResolvedValue({ enabled: true, max_size_mb: 1, max_pixels: 200, max_total_size_mb: 2 });
  render(createElement(ClipboardPage));
  await screen.findByText(/每张最多 1 MiB/);
  fireEvent.change(screen.getByLabelText(/选择图片，或/), { target: { files: [new File(['svg'], 'a.svg', { type: 'image/svg+xml' })] } });
  expect(screen.getByRole('alert').textContent).toContain('PNG 或 JPEG');
  expect((screen.getByRole('button', { name: '发布' }) as HTMLButtonElement).disabled).toBe(true);
  expect(createClipboardImage).not.toHaveBeenCalled();
});

it('rejects whitespace and counts the UTF-8 byte limit', async () => {
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  const input = screen.getByLabelText('输入或粘贴文本');
  const publish = screen.getByRole('button', { name: '发布' }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: ' \n\t　' } });
  expect(publish.disabled).toBe(true);
  fireEvent.change(input, { target: { value: '中'.repeat(Math.floor(CLIPBOARD_MAX_BYTES / 3) + 1) } });
  expect(publish.disabled).toBe(true);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(input, { target: { value: 'a'.repeat(CLIPBOARD_MAX_BYTES) } });
  expect(publish.disabled).toBe(false);
  expect(createClipboard).not.toHaveBeenCalled();
});

it('uses one submit button and removing an image does not publish either draft', async () => {
  render(createElement(ClipboardPage));
  await waitFor(() => expect((screen.getByLabelText(/选择图片，或/) as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '保留的文本' } });
  fireEvent.change(screen.getByLabelText(/选择图片，或/), { target: { files: [new File(['png'], 'a.png', { type: 'image/png' })] } });
  expect(screen.getAllByRole('button', { name: '发布' })).toHaveLength(1);
  expect(screen.getByText(/本次发布图片，文本草稿将保留/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '移除图片' }));
  expect(createClipboardImage).not.toHaveBeenCalled();
  expect(createClipboard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  await screen.findByText('文本已发布。');
  expect(createClipboard).toHaveBeenCalledWith('保留的文本');
});

it('keeps the draft after a failed publish and allows retry', async () => {
  vi.mocked(createClipboard).mockRejectedValueOnce(new Error('磁盘不可写'));
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  expect((await screen.findByRole('alert')).textContent).toContain('磁盘不可写');
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('保留草稿');
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  await screen.findByRole('article', { name: '记录 1' });
  expect(createClipboard).toHaveBeenCalledTimes(2);
});

it('requires confirmation to clear all records and preserves the draft', async () => {
  history = [record('第一条', 'one'), record('第二条', 'two')];
  render(createElement(ClipboardPage));
  await screen.findByRole('article', { name: '记录 2' });
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '未发布草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  expect(clearClipboard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('button', { name: '确认全部删除' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  fireEvent.click(screen.getByRole('button', { name: '确认全部删除' }));
  await screen.findByText('全部记录已删除。');
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  expect(clearClipboard).toHaveBeenCalledTimes(1);
  expect(deleteClipboard).not.toHaveBeenCalled();
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('未发布草稿');
  expect((screen.getByRole('button', { name: '全部删除' }) as HTMLButtonElement).disabled).toBe(true);
});

it('retains all records when clearing fails and allows retry', async () => {
  history = [record()];
  vi.mocked(clearClipboard).mockRejectedValueOnce(new Error('清空失败'));
  render(createElement(ClipboardPage));
  await screen.findByRole('article', { name: '记录 1' });
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  fireEvent.click(screen.getByRole('button', { name: '确认全部删除' }));
  expect((await screen.findByRole('alert')).textContent).toContain('清空失败');
  expect(screen.getByRole('article', { name: '记录 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认全部删除' }));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
});

it('shows load errors and lets the user refresh', async () => {
  vi.mocked(listClipboard).mockRejectedValueOnce(new Error('网络不可用'));
  render(createElement(ClipboardPage));
  expect((await screen.findByRole('alert')).textContent).toContain('网络不可用');
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
});

it('requires confirmation and retains records when deletion fails', async () => {
  history = [record()];
  vi.mocked(deleteClipboard).mockRejectedValueOnce(new Error('删除失败'));
  render(createElement(ClipboardPage));
  await screen.findByRole('article', { name: '记录 1' });
  fireEvent.click(screen.getByRole('button', { name: '删除记录 1' }));
  expect(deleteClipboard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('button', { name: '确认删除记录 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '删除记录 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认删除记录 1' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('article', { name: '记录 1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认删除记录 1' }));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  expect(deleteClipboard).toHaveBeenCalledWith('entry-1');
});

it.each(['denied', 'unavailable'])('selects a manual copy field when clipboard access is %s', async kind => {
  history = [record('保留\n所有换行')];
  if (kind === 'denied') writeText.mockRejectedValue(new Error('Permission denied'));
  else Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(createElement(ClipboardPage));
  await screen.findByRole('article', { name: '记录 1' });
  fireEvent.click(screen.getByRole('button', { name: '复制记录 1' }));
  const field = await screen.findByLabelText(/无法自动复制/) as HTMLTextAreaElement;
  expect(field.value).toBe(history[0].text);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(history[0].text.length);
  expect(document.activeElement).toBe(field);
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(screen.queryByLabelText(/无法自动复制/)).toBeNull());
});

const advancePoll = (milliseconds = CLIPBOARD_REFRESH_INTERVAL_MS) =>
  act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });

async function openPollingPage() {
  vi.useFakeTimers();
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(ClipboardPage)); });
  return view;
}

function setVisibility(value: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  fireEvent(document, new Event('visibilitychange'));
}

it('uses conditional background reads, preserves content on 304, and forces manual reads', async () => {
  history = [record('unchanged')];
  const view = await openPollingPage();
  const tag = JSON.stringify(history);
  expect(vi.mocked(listClipboard).mock.calls[0][1]).toBeUndefined();
  const article = screen.getByRole('article');
  vi.mocked(listClipboard).mockRejectedValueOnce(new Error('offline'));
  await advancePoll();
  expect(screen.getByText(/自动更新暂不可用/)).toBeTruthy();
  await advancePoll();
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBe(tag);
  expect(screen.getByRole('article')).toBe(article);
  expect(screen.queryByText(/自动更新暂不可用/)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '刷新' })); });
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBeUndefined();
  view.unmount();
  await act(async () => { render(createElement(ClipboardPage)); });
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBeUndefined();
});

it('invalidates the validator after a successful mutation even when the full resync fails', async () => {
  history = [record('old')];
  await openPollingPage();
  vi.mocked(listClipboard).mockRejectedValueOnce(new Error('resync failed'));
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: 'new' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发布' })); });
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBeUndefined();
  // The server can return to the original representation before the next poll.
  history = [record('old')];
  await advancePoll();
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBeUndefined();
  expect(screen.queryByText('new')).toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  await advancePoll();
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBe(JSON.stringify(history));
});

it('does not retain the validator of an aborted response', async () => {
  history = [record('kept')];
  await openPollingPage();
  const tag = JSON.stringify(history);
  let finish!: (value: { entries: ClipboardEntry[]; etag: string }) => void;
  vi.mocked(listClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  await act(async () => { finish({ entries: [], etag: '"stale"' }); });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await advancePoll();
  expect(vi.mocked(listClipboard).mock.lastCall?.[1]).toBe(tag);
  expect(screen.getByText('kept')).toBeTruthy();
});

it('automatically loads additions and deletions without changing a draft, then stops on unmount', async () => {
  history = [record('旧内容')];
  const view = await openPollingPage();
  expect(listClipboard).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '未发布草稿' } });
  history = [record('另一台设备的新内容', 'new')];
  await advancePoll();
  expect(screen.getByText('另一台设备的新内容')).toBeTruthy();
  expect(screen.queryByText('旧内容')).toBeNull();
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('未发布草稿');
  expect(screen.queryByRole('button', { name: '加载中…' })).toBeNull();
  history = [];
  await advancePoll();
  expect(screen.getByText('还没有共享内容，发布第一段文本吧。')).toBeTruthy();
  const calls = vi.mocked(listClipboard).mock.calls.length;
  view.unmount();
  await advancePoll(CLIPBOARD_REFRESH_INTERVAL_MS * 3);
  expect(listClipboard).toHaveBeenCalledTimes(calls);
});

it('waits for a slow background request before scheduling another poll', async () => {
  await openPollingPage();
  let finish!: (value: { entries: ClipboardEntry[] }) => void;
  vi.mocked(listClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  await advancePoll(CLIPBOARD_REFRESH_INTERVAL_MS * 4);
  expect(listClipboard).toHaveBeenCalledTimes(2);
  await act(async () => { finish({ entries: [record('慢请求结果')] }); });
  expect(screen.getByText('慢请求结果')).toBeTruthy();
  await advancePoll();
  expect(listClipboard).toHaveBeenCalledTimes(3);
});

it('pauses polling during publication and resumes after its list refresh', async () => {
  await openPollingPage();
  let finish!: (entry: ClipboardEntry) => void;
  vi.mocked(createClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '发布中' } });
  fireEvent.click(screen.getByRole('button', { name: '发布' }));
  await advancePoll(CLIPBOARD_REFRESH_INTERVAL_MS * 3);
  expect(listClipboard).toHaveBeenCalledTimes(1);
  await act(async () => {
    const entry = record('发布中');
    history = [entry];
    finish(entry);
  });
  expect(listClipboard).toHaveBeenCalledTimes(2);
  await advancePoll();
  expect(listClipboard).toHaveBeenCalledTimes(3);
});

it.each(['single', 'all', 'copy'])('pauses background updates during %s confirmation or manual copy', async kind => {
  history = [record('保留当前记录')];
  writeText.mockRejectedValueOnce(new Error('denied'));
  await openPollingPage();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: kind === 'single' ? '删除记录 1' : kind === 'all' ? '全部删除' : '复制记录 1' }));
  });
  history = [];
  await advancePoll(CLIPBOARD_REFRESH_INTERVAL_MS * 3);
  expect(listClipboard).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('article', { name: '记录 1' })).toBeTruthy();
  if (kind === 'copy') {
    const input = screen.getByLabelText(/无法自动复制/) as HTMLTextAreaElement;
    expect(input.selectionEnd - input.selectionStart).toBe(input.value.length);
  }
  fireEvent.click(screen.getByRole('button', { name: kind === 'copy' ? '关闭' : '取消' }));
  await advancePoll();
  expect(listClipboard).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('article')).toBeNull();
});

it('cancels an in-flight background response before entering deletion confirmation', async () => {
  history = [record()];
  await openPollingPage();
  let finish!: (value: { entries: ClipboardEntry[] }) => void;
  vi.mocked(listClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  const signal = vi.mocked(listClipboard).mock.calls[1][0];
  fireEvent.click(screen.getByRole('button', { name: '全部删除' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish({ entries: [] }); });
  expect(screen.getByRole('button', { name: '确认全部删除' })).toBeTruthy();
  expect(screen.getByRole('article', { name: '记录 1' })).toBeTruthy();
});

it('pauses hidden pages and loads immediately when visible, ignoring the cancelled response', async () => {
  await openPollingPage();
  let finish!: (value: { entries: ClipboardEntry[] }) => void;
  vi.mocked(listClipboard).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advancePoll();
  const signal = vi.mocked(listClipboard).mock.calls[1][0];
  act(() => { setVisibility('hidden'); });
  expect(signal?.aborted).toBe(true);
  await advancePoll(CLIPBOARD_REFRESH_INTERVAL_MS * 4);
  expect(listClipboard).toHaveBeenCalledTimes(2);
  history = [record('切回后立即获取')];
  await act(async () => { setVisibility('visible'); });
  expect(listClipboard).toHaveBeenCalledTimes(3);
  expect(screen.getByText('切回后立即获取')).toBeTruthy();
  await act(async () => { finish({ entries: [] }); });
  expect(screen.getByText('切回后立即获取')).toBeTruthy();
  await advancePoll();
  expect(listClipboard).toHaveBeenCalledTimes(4);
});

it('retains data and operation errors after a failed poll and retries automatically', async () => {
  history = [record('当前内容')];
  await openPollingPage();
  vi.mocked(createClipboard).mockRejectedValueOnce(new Error('发布失败'));
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '草稿' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发布' })); });
  vi.mocked(listClipboard).mockRejectedValueOnce(new Error('offline'));
  await advancePoll();
  expect(screen.getByText('当前内容')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('发布失败');
  expect(screen.getByText(/自动更新暂不可用/)).toBeTruthy();
  history = [record('恢复连接后的内容', 'new')];
  await advancePoll();
  expect(screen.getByText('恢复连接后的内容')).toBeTruthy();
  expect(screen.queryByText(/自动更新暂不可用/)).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('发布失败');
});
