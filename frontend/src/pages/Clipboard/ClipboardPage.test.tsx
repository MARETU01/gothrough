import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClipboardPage from './ClipboardPage';
import { CLIPBOARD_MAX_BYTES, createClipboard, deleteClipboard, clearClipboard, listClipboard, type ClipboardEntry } from '@/services/clipboard';

vi.mock('@/services/clipboard', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/clipboard')>(),
  listClipboard: vi.fn(), createClipboard: vi.fn(), deleteClipboard: vi.fn(), clearClipboard: vi.fn(),
}));

const record = (text = '第一行\n<script>alert(1)</script>', id = 'entry-1'): ClipboardEntry => ({
  id, text, created_at: '2026-11-05T12:00:00Z',
});
let history: ClipboardEntry[];
const writeText = vi.fn();
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  history = [];
  vi.mocked(clearClipboard).mockImplementation(async () => {
    history = [];
    return { status: 'deleted' };
  });
  vi.mocked(listClipboard).mockImplementation(async () => ({ entries: [...history] }));
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
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

it('publishes literal multiline text, refreshes history, and copies it', async () => {
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  const text = '  中文\n<script>alert(1)</script>\t ';
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: '发布文本' }));
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

it('rejects whitespace and counts the UTF-8 byte limit', async () => {
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  const input = screen.getByLabelText('输入或粘贴文本');
  const publish = screen.getByRole('button', { name: '发布文本' }) as HTMLButtonElement;
  fireEvent.change(input, { target: { value: ' \n\t　' } });
  expect(publish.disabled).toBe(true);
  fireEvent.change(input, { target: { value: '中'.repeat(Math.floor(CLIPBOARD_MAX_BYTES / 3) + 1) } });
  expect(publish.disabled).toBe(true);
  expect(input.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(input, { target: { value: 'a'.repeat(CLIPBOARD_MAX_BYTES) } });
  expect(publish.disabled).toBe(false);
  expect(createClipboard).not.toHaveBeenCalled();
});

it('keeps the draft after a failed publish and allows retry', async () => {
  vi.mocked(createClipboard).mockRejectedValueOnce(new Error('磁盘不可写'));
  render(createElement(ClipboardPage));
  await screen.findByText('还没有共享内容，发布第一段文本吧。');
  fireEvent.change(screen.getByLabelText('输入或粘贴文本'), { target: { value: '保留草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发布文本' }));
  expect((await screen.findByRole('alert')).textContent).toContain('磁盘不可写');
  expect((screen.getByLabelText('输入或粘贴文本') as HTMLTextAreaElement).value).toBe('保留草稿');
  fireEvent.click(screen.getByRole('button', { name: '发布文本' }));
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
