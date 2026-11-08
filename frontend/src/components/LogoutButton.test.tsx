import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccessContext } from '@/contexts/AccessContext';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';
import { LogoutButton } from './LogoutButton';

vi.mock('@/contexts/UploadQueueContext', () => ({ useSharedUploadQueue: vi.fn() }));
afterEach(cleanup);

function openQueue(state: { running: boolean; items: { state: string }[] }) {
  vi.mocked(useSharedUploadQueue).mockReturnValue({ ...state, readingFolders: false } as ReturnType<typeof useSharedUploadQueue>);
  const logout = vi.fn(async () => {});
  render(<AccessContext.Provider value={{ enabled: true, logout }}><LogoutButton /></AccessContext.Provider>);
  return logout;
}

it('keeps unfinished uploads until the user explicitly confirms logout', async () => {
  const logout = openQueue({ running: true, items: [{ state: 'uploading' }] });
  fireEvent.click(screen.getByRole('button', { name: '锁定退出' }));
  expect(screen.getByRole('dialog', { name: '确认锁定退出？' })).toBeTruthy();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '留在页面' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(logout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '锁定退出' }));
  fireEvent.click(screen.getByRole('button', { name: '中断上传并退出' }));
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
});

it('also protects queued files, while completed queues log out without confirmation', async () => {
  let logout = openQueue({ running: false, items: [{ state: 'pending' }] });
  fireEvent.click(screen.getByRole('button', { name: '锁定退出' }));
  expect(logout).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  cleanup();
  logout = openQueue({ running: false, items: [{ state: 'success' }] });
  fireEvent.click(screen.getByRole('button', { name: '锁定退出' }));
  await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});
