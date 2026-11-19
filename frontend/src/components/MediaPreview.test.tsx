import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaPreview } from './MediaPreview';
import { checkMedia, MediaPreviewError } from '@/services/media';

vi.mock('@/services/media', async original => ({ ...await original<typeof import('@/services/media')>(), checkMedia: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('reports an unavailable PDF without embedding its HTTP error document', async () => {
  vi.mocked(checkMedia).mockRejectedValue(new Error('missing'));
  const view = render(<MediaPreview kind="pdf" url="/test.pdf" name="test.pdf" />);
  await screen.findByRole('alert');
  expect(view.container.querySelector('iframe')).toBeNull();
});

it('opens an available PDF and cancels its probe on unmount', async () => {
  vi.mocked(checkMedia).mockResolvedValue();
  const view = render(<MediaPreview kind="pdf" url="/test.pdf" name="test.pdf" />);
  expect(await screen.findByTitle('test.pdf')).toBeTruthy();
  const signal = vi.mocked(checkMedia).mock.calls[0][1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it('checks session status after a native video failure', async () => {
  vi.mocked(checkMedia).mockResolvedValue();
  const view = render(<MediaPreview kind="video" url="/test.mp4" name="test.mp4" />);
  fireEvent.error(view.container.querySelector('video')!);
  expect(checkMedia).toHaveBeenCalledWith('/test.mp4', expect.any(AbortSignal));
  expect(await screen.findByRole('alert')).toBeTruthy();
});

it('retries a failed image in place and cancels the previous attempt', async () => {
  vi.mocked(checkMedia).mockRejectedValueOnce(new MediaPreviewError('missing'));
  const view = render(<MediaPreview kind="image" url="/test.png" name="test.png" />);
  const original = view.container.querySelector('img')!;
  fireEvent.error(original);
  expect((await screen.findByRole('alert')).textContent).toContain('文件已不存在');
  const signal = vi.mocked(checkMedia).mock.calls[0][1]!;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(signal.aborted).toBe(true);
  const replacement = view.container.querySelector('img')!;
  expect(replacement).not.toBe(original);
  expect(replacement.getAttribute('src')).toBe('/test.png');
  fireEvent.load(replacement);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('rechecks a failed PDF before embedding on retry', async () => {
  vi.mocked(checkMedia).mockRejectedValueOnce(new MediaPreviewError('network')).mockResolvedValueOnce();
  render(<MediaPreview kind="pdf" url="/test.pdf" name="test.pdf" />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByTitle('test.pdf')).toBeTruthy();
  expect(checkMedia).toHaveBeenCalledTimes(2);
});

it('diagnoses stalled media but leaves successfully loaded media alone', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(checkMedia).mockRejectedValue(new MediaPreviewError('network'));
    const view = render(<MediaPreview kind="audio" url="/test.mp3" name="test.mp3" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByRole('alert').textContent).toContain('连接失败或超时');
    view.unmount();
    vi.clearAllMocks();
    const loaded = render(<MediaPreview kind="image" url="/test.png" name="test.png" />);
    fireEvent.load(loaded.container.querySelector('img')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(checkMedia).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
