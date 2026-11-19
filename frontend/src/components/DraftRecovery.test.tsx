import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DraftRecovery, type DraftComparison } from './DraftRecovery';

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(navigator, 'clipboard'); });

it('copies the entire draft and falls back to selected manual text when clipboard access fails', async () => {
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<DraftRecovery text={'<script>literal</script>\nsecond line'} filename="draft.txt" disabled={false} compare={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '复制草稿' }));
  await screen.findByText('草稿已复制');
  expect(writeText).toHaveBeenCalledWith('<script>literal</script>\nsecond line');
  fireEvent.click(screen.getByRole('button', { name: '复制草稿' }));
  const fallback = await screen.findByRole('textbox') as HTMLTextAreaElement;
  expect(fallback.readOnly).toBe(true);
  expect(fallback.value).toBe('<script>literal</script>\nsecond line');
  expect(fallback.selectionStart).toBe(0);
  expect(fallback.selectionEnd).toBe(fallback.value.length);
  expect(document.activeElement).toBe(fallback);
});

it('hides stale comparisons after the draft changes and aborts comparison on unmount', async () => {
  let finish!: (items: DraftComparison[]) => void;
  const compare = vi.fn((_signal: AbortSignal) => new Promise<DraftComparison[]>(resolve => { finish = resolve; }));
  const view = render(<DraftRecovery text="first" filename="draft.txt" disabled={false} compare={compare} />);
  fireEvent.click(screen.getByRole('button', { name: '对比最新内容' }));
  view.rerender(<DraftRecovery text="second" filename="draft.txt" disabled={false} compare={compare} />);
  await act(async () => finish([{ title: 'stale comparison', base: 'old', draft: 'first', latest: 'remote', changed: true }]));
  expect(screen.queryByText('stale comparison')).toBeNull();
  const signal = compare.mock.calls[0][0] as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
});
