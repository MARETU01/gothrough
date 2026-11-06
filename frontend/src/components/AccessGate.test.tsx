import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { responseApi } from '@/services/http';
import { AccessGate } from './AccessGate';

vi.mock('@/services/http', () => ({ responseApi: { get: vi.fn(), post: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('keeps protected content unmounted until the password is accepted', async () => {
  vi.mocked(responseApi.get).mockResolvedValue({ data: { enabled: true, authenticated: false } });
  vi.mocked(responseApi.post).mockRejectedValueOnce({ response: { status: 401 } }).mockResolvedValueOnce({ data: { enabled: true, authenticated: true } });
  render(<AccessGate><div>protected content</div></AccessGate>);
  const input = await screen.findByLabelText('访问口令');
  expect(screen.queryByText('protected content')).toBeNull();
  fireEvent.change(input, { target: { value: 'wrong-password' } });
  fireEvent.click(screen.getByRole('button', { name: '解锁空间' }));
  await screen.findByText('口令不正确，请重新输入。');
  expect(screen.queryByText('protected content')).toBeNull();
  fireEvent.change(input, { target: { value: 'correct-password' } });
  fireEvent.click(screen.getByRole('button', { name: '解锁空间' }));
  await screen.findByText('protected content');
  expect(responseApi.post).toHaveBeenLastCalledWith('/auth/login', { password: 'correct-password' });
  act(() => window.dispatchEvent(new Event('gothrough:auth-required')));
  expect(screen.queryByText('protected content')).toBeNull();
  await screen.findByText('解锁状态已失效，请重新输入口令。');
});

it('allows access when protection is disabled and fails closed on connection errors', async () => {
  vi.mocked(responseApi.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { enabled: false, authenticated: true } });
  render(<AccessGate><div>protected content</div></AccessGate>);
  await screen.findByRole('alert');
  expect(screen.queryByText('protected content')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试连接' }));
  await screen.findByText('protected content');
});
