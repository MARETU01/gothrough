import { AxiosError, CanceledError } from 'axios';
import { expect, it, vi } from 'vitest';
import api from './http';

it('rejects cancelled requests without logging an error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cancelled = new CanceledError('canceled');
  await expect(api.get('/cancelled', {
    adapter: async () => { throw cancelled; },
  })).rejects.toBe(cancelled);
  expect(log).not.toHaveBeenCalled();
});

it('still logs and rejects network failures', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new AxiosError('Network Error', 'ERR_NETWORK');
  await expect(api.get('/offline', {
    adapter: async () => { throw failure; },
  })).rejects.toBe(failure);
  expect(log).toHaveBeenCalledExactlyOnceWith('请求失败:', 'Network Error');
});
