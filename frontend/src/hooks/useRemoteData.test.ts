import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NOT_MODIFIED, useRemoteData, type RemoteLoadContext } from './useRemoteData';

afterEach(cleanup);

it('keeps the same data on an unchanged response and clears only sync errors', async () => {
  const entries = ['existing'];
  const load = vi.fn<() => Promise<string[] | typeof NOT_MODIFIED>>()
    .mockResolvedValueOnce(entries).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(NOT_MODIFIED);
  const hook = renderHook(() => useRemoteData<string[]>(load, []));
  await waitFor(() => expect(hook.result.current.data).toBe(entries));
  act(() => hook.result.current.setError('operation failed'));
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(hook.result.current.backgroundError).toBe('offline');
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(hook.result.current.data).toBe(entries);
  expect(hook.result.current.backgroundError).toBe('');
  expect(hook.result.current.error).toBe('operation failed');
});

it('commits response metadata only with accepted data, including cancelled late responses', async () => {
  const pending = deferred<string>();
  const commit = vi.fn();
  const staleCommit = vi.fn();
  const load = vi.fn<(signal?: AbortSignal, context?: RemoteLoadContext) => Promise<string>>()
    .mockImplementationOnce(async (_, context) => { context?.onAccepted(commit); return 'initial'; })
    .mockImplementationOnce(async (_, context) => {
      const data = await pending.promise;
      context?.onAccepted(staleCommit);
      return data;
    });
  const hook = renderHook(() => useRemoteData(load, ''));
  await waitFor(() => expect(hook.result.current.data).toBe('initial'));
  expect(commit).toHaveBeenCalledOnce();
  let poll!: Promise<void>;
  act(() => { poll = hook.result.current.refresh({ background: true }); });
  act(() => hook.result.current.cancelBackground());
  await act(async () => { pending.resolve('stale'); await poll; });
  expect(staleCommit).not.toHaveBeenCalled();
  expect(hook.result.current.data).toBe('initial');
});

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
  const pending = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered').mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useRemoteData(load, 'initial'));
  await waitFor(() => expect(hook.result.current.error).toBe('offline'));
  await act(async () => { await hook.result.current.refresh(); });
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.data).toBe('recovered');
  let refresh!: Promise<void>;
  act(() => { refresh = hook.result.current.refresh(); });
  hook.unmount();
  expect(load.mock.calls[2][0]?.aborted).toBe(true);
  await act(async () => { pending.resolve('late'); await refresh; });
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

it('updates silently in the background without clearing an operation error', async () => {
  const pending = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockResolvedValueOnce('initial').mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useRemoteData(load, ''));
  await waitFor(() => expect(hook.result.current.data).toBe('initial'));
  let poll!: Promise<void>;
  act(() => {
    hook.result.current.setError('publish failed');
    poll = hook.result.current.refresh({ background: true });
  });
  expect(hook.result.current.loading).toBe(false);
  expect(hook.result.current.data).toBe('initial');
  expect(hook.result.current.error).toBe('publish failed');
  await act(async () => { pending.resolve('new'); await poll; });
  expect(hook.result.current.data).toBe('new');
  expect(hook.result.current.error).toBe('publish failed');
});

it('preserves data after a failed poll and clears only the sync error after recovery', async () => {
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockResolvedValueOnce('initial').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered');
  const hook = renderHook(() => useRemoteData(load, ''));
  await waitFor(() => expect(hook.result.current.data).toBe('initial'));
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(hook.result.current.data).toBe('initial');
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.backgroundError).toBe('offline');
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(hook.result.current.data).toBe('recovered');
  expect(hook.result.current.backgroundError).toBe('');
});

it('skips overlapping polls and lets a manual refresh supersede background work', async () => {
  const initial = deferred<string>();
  const background = deferred<string>();
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockReturnValueOnce(initial.promise).mockReturnValueOnce(background.promise).mockResolvedValueOnce('manual');
  const hook = renderHook(() => useRemoteData(load, ''));
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0][0]?.aborted).toBe(false);
  await act(async () => { initial.resolve('initial'); });
  let poll!: Promise<void>;
  act(() => { poll = hook.result.current.refresh({ background: true }); });
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => { await hook.result.current.refresh(); });
  expect(load.mock.calls[1][0]?.aborted).toBe(true);
  await act(async () => { background.resolve('stale'); await poll; });
  expect(hook.result.current.data).toBe('manual');
});

it('recovers an initial load error through background refresh', async () => {
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('recovered');
  const hook = renderHook(() => useRemoteData(load, ''));
  await waitFor(() => expect(hook.result.current.error).toBe('offline'));
  await act(async () => { await hook.result.current.refresh({ background: true }); });
  expect(hook.result.current.error).toBe('');
  expect(hook.result.current.data).toBe('recovered');
});

it('allows a new operation to explicitly clear a previous loading error', async () => {
  const load = vi.fn<(signal?: AbortSignal) => Promise<string>>().mockRejectedValue(new Error('offline'));
  const hook = renderHook(() => useRemoteData(load, ''));
  await waitFor(() => expect(hook.result.current.error).toBe('offline'));
  act(() => { hook.result.current.setError(''); });
  expect(hook.result.current.error).toBe('');
});
