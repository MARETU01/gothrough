import { createElement, StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadQueueProvider } from './UploadQueueProvider';
import { useSharedUploadQueue } from './UploadQueueContext';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';

vi.mock('@/services/upload', () => ({
  initUpload: vi.fn(), uploadChunk: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
  getErrorBody: () => null, isCanceledError: () => false,
}));

function QueuePage() {
  const queue = useSharedUploadQueue();
  return createElement('div', null,
    createElement('button', { onClick: () => queue.handleSelection([new File(['hello'], 'test.txt')] as unknown as FileList) }, '选择文件'),
    createElement('button', { onClick: queue.startAllUploads }, '开始'),
    createElement('button', { onClick: queue.resetAll }, '清空'),
    createElement('output', null, queue.items.map(item => item.state).join(',')),
    createElement(Link, { to: '/files' }, '文件列表'),
  );
}

function openApp() {
  return render(createElement(StrictMode, null,
    createElement(MemoryRouter, { initialEntries: ['/upload'] },
      createElement(UploadQueueProvider, null,
        createElement(Routes, null,
          createElement(Route, { path: '/upload', element: createElement(QueuePage) }),
          createElement(Route, { path: '/files', element: createElement(Link, { to: '/upload' }, '返回上传') }),
        ),
      ),
    ),
  ));
}

function leaveIsPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(initUpload).mockResolvedValue({ session_id: 'test', total_chunks: 1, chunk_size: 5, final_filename: 'test.txt' });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'test.txt' });
  vi.mocked(cancelUpload).mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

it('continues the same upload across route changes and removes the leave warning after success', async () => {
  let finish!: (value: { received: number }) => void;
  vi.mocked(uploadChunk).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  openApp();
  expect(leaveIsPrevented()).toBe(false);
  fireEvent.click(screen.getByText('选择文件'));
  expect(leaveIsPrevented()).toBe(true);
  fireEvent.click(screen.getByText('开始'));
  await waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(uploadChunk).mock.calls[0][0].signal;
  fireEvent.click(screen.getByText('文件列表'));
  expect(signal?.aborted).toBe(false);
  expect(cancelUpload).not.toHaveBeenCalled();
  expect(leaveIsPrevented()).toBe(true);
  await act(async () => { finish({ received: 1 }); });
  await waitFor(() => expect(completeUpload).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText('返回上传'));
  expect(screen.getByRole('status').textContent).toBe('success');
  expect(initUpload).toHaveBeenCalledTimes(1);
  expect(leaveIsPrevented()).toBe(false);
});

it('keeps pending selections across navigation and removes the warning after clearing or unmounting', () => {
  const view = openApp();
  fireEvent.click(screen.getByText('选择文件'));
  fireEvent.click(screen.getByText('文件列表'));
  expect(leaveIsPrevented()).toBe(true);
  fireEvent.click(screen.getByText('返回上传'));
  expect(screen.getByRole('status').textContent).toBe('pending');
  fireEvent.click(screen.getByText('清空'));
  expect(leaveIsPrevented()).toBe(false);
  fireEvent.click(screen.getByText('选择文件'));
  expect(leaveIsPrevented()).toBe(true);
  view.unmount();
  expect(leaveIsPrevented()).toBe(false);
});
