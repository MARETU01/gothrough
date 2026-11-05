import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRemoteData } from './useRemoteData';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('keeps the latest result when an aborted request resolves late', async () => {
  const first = deferred<string>();
  const second = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const hook = renderHook(() => useRemoteData(load, 'initial'));
  let refresh!: Promise<void>;
  act(() => { refresh = hook.result.current.refresh(); });
  expect(load.mock.calls[0][0]?.aborted).toBe(true);
  await act(async () => { second.resolve('new'); await refresh; });
  await act(async () => { first.resolve('old'); });
  expect(hook.result.current.data).toBe('new');
  expect(hook.result.current.loading).toBe(false);
});

it('cancels a list before local changes and ignores late failures', async () => {
  const pending = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>().mockReturnValue(pending.promise);
  const hook = renderHook(() => useRemoteData(load, 'initial'));
  act(() => {
    hook.result.current.cancel();
    hook.result.current.setData('updated locally');
  });
  expect(load.mock.calls[0][0]?.aborted).toBe(true);
  expect(hook.result.current.loading).toBe(false);
  await act(async () => { pending.reject(new Error('old failure')); });
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.data).toBe('updated locally');
});

it('reports errors, retries, and cancels the request on unmount', async () => {
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered');
  const hook = renderHook(() => useRemoteData(load, 'initial'));
  await waitFor(() => expect(hook.result.current.error).toBe('offline'));
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.data).toBe('recovered');
  hook.unmount();
  expect(load.mock.calls[1][0]?.aborted).toBe(true);
  expect(hook.result.current.mounted.current).toBe(false);
});

it('loads a fresh page after the previous page unmounts with a pending request', async () => {
  const pending = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockReturnValueOnce(pending.promise).mockResolvedValueOnce('loaded');
  const previous = renderHook(() => useRemoteData(load, 'initial'));
  previous.unmount();
  const hook = renderHook(() => useRemoteData(load, 'initial'));
  await waitFor(() => expect(hook.result.current.data).toBe('loaded'));
  expect(load.mock.calls[0][0]?.aborted).toBe(true);
  await act(async () => { pending.resolve('old page'); });
  expect(hook.result.current.data).toBe('loaded');
  expect(hook.result.current.mounted.current).toBe(true);
});
