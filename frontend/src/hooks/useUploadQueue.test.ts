import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadQueue } from './useUploadQueue';
import { cancelUpload, completeUpload, initUpload, uploadChunk } from '@/services/upload';

vi.mock('@/services/upload', () => ({
  initUpload: vi.fn(), uploadChunk: vi.fn(), completeUpload: vi.fn(), cancelUpload: vi.fn(),
  getErrorBody: () => null,
  isCanceledError: (err: unknown) => err instanceof Error && err.name === 'AbortError',
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const session = (name = 'test', chunks = 1) => ({ session_id: name, total_chunks: chunks, chunk_size: 5, final_filename: name });
const selectFiles = (hook: ReturnType<typeof renderHook<ReturnType<typeof useUploadQueue>, unknown>>, count: number, size = 5) => {
  act(() => hook.result.current.handleSelection(Array.from({ length: count }, (_, i) => new File(['x'.repeat(size)], `file-${i}`)) as unknown as FileList));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(initUpload).mockImplementation(async ({ filename }) => session(filename));
  vi.mocked(uploadChunk).mockResolvedValue({ received: 1 });
  vi.mocked(completeUpload).mockResolvedValue({ saved_filename: 'saved' });
  vi.mocked(cancelUpload).mockResolvedValue({ status: 'ok' });
});
afterEach(cleanup);

describe('upload queue lifecycle', () => {
  it('shows preparation and merge phases, including successful empty files', async () => {
    const init = deferred<ReturnType<typeof session>>();
    const complete = deferred<{ saved_filename: string }>();
    vi.mocked(initUpload).mockReturnValue(init.promise);
    vi.mocked(completeUpload).mockReturnValue(complete.promise);
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 1, 0);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    expect(hook.result.current.items[0].state).toBe('initializing');
    await act(async () => { init.resolve(session('empty', 0)); });
    expect(hook.result.current.items[0].state).toBe('completing');
    await act(async () => { complete.resolve({ saved_filename: 'empty' }); await run; });
    expect(hook.result.current.items[0].state).toBe('success');
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it('keeps a file-specific error and retries only the selected file', async () => {
    vi.mocked(initUpload).mockRejectedValue(new Error('offline'));
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 2);
    await act(async () => { await hook.result.current.startAllUploads(); });
    expect(hook.result.current.items.every((item) => item.error === 'offline')).toBe(true);
    vi.mocked(initUpload).mockResolvedValue(session());
    const file = hook.result.current.items[0].file;
    await act(async () => { await hook.result.current.retryItem(`${file.name}-${file.size}-${file.lastModified}`); });
    expect(hook.result.current.items[0].state).toBe('success');
    expect(hook.result.current.items[0].error).toBe('');
    expect(hook.result.current.items[1].state).toBe('error');
  });
  it('cleans up late initialization and never starts the next files after cancel', async () => {
    const init = deferred<ReturnType<typeof session>>();
    vi.mocked(initUpload).mockReturnValue(init.promise);
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 4);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    act(() => hook.result.current.cancelAll());
    await act(async () => { init.resolve(session()); await run; });
    expect(initUpload).toHaveBeenCalledTimes(2);
    expect(uploadChunk).not.toHaveBeenCalled();
    expect(cancelUpload).toHaveBeenCalledTimes(2);
    expect(hook.result.current.running).toBe(false);
    expect(hook.result.current.items.every((item) => item.state === 'pending')).toBe(true);
  });

  it('resumes even when pause and resume happen before a worker observes pause', async () => {
    const init = deferred<ReturnType<typeof session>>();
    vi.mocked(initUpload).mockReturnValue(init.promise);
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 1);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    act(() => { hook.result.current.pauseAll(); hook.result.current.resumeAll(); });
    await act(async () => { init.resolve(session()); await run; });
    expect(hook.result.current.items[0].state).toBe('success');
  });

  it('skips removed pending files and prevents duplicate starts', async () => {
    const init = deferred<ReturnType<typeof session>>();
    vi.mocked(initUpload).mockReturnValue(init.promise);
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 3);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    act(() => { hook.result.current.removeItem(2); void hook.result.current.startAllUploads(); });
    await act(async () => { init.resolve(session()); await run; });
    expect(initUpload).toHaveBeenCalledTimes(2);
  });

  it('aborts siblings and waits for them before allowing retry', async () => {
    vi.mocked(initUpload).mockResolvedValue(session('test', 3));
    const sibling = deferred<{ received: number }>();
    let signal: AbortSignal | undefined;
    vi.mocked(uploadChunk).mockImplementation(({ chunkIndex, signal: requestSignal }) => {
      if (chunkIndex === 0) return Promise.reject(new Error('broken chunk'));
      signal = requestSignal;
      return sibling.promise;
    });
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 1, 15);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(hook.result.current.running).toBe(true);
    act(() => { void hook.result.current.startAllUploads(); });
    expect(initUpload).toHaveBeenCalledTimes(1);
    await act(async () => { sibling.resolve({ received: 2 }); await run; });
    expect(hook.result.current.items[0].state).toBe('error');
    expect(completeUpload).not.toHaveBeenCalled();
  });

  it('aborts requests and cleans up sessions when leaving the page', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(uploadChunk).mockImplementation(({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise((_, reject) => requestSignal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    const hook = renderHook(useUploadQueue);
    selectFiles(hook, 1);
    let run!: Promise<void>;
    act(() => { run = hook.result.current.startAllUploads(); });
    await waitFor(() => expect(signal).toBeDefined());
    hook.unmount();
    await run;
    expect(signal?.aborted).toBe(true);
    expect(cancelUpload).toHaveBeenCalled();
    expect(completeUpload).not.toHaveBeenCalled();
  });
});
