import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaPreview } from './MediaPreview';
import { checkMedia } from '@/services/media';

vi.mock('@/services/media', () => ({ checkMedia: vi.fn() }));
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
  expect(screen.getByRole('alert')).toBeTruthy();
});
