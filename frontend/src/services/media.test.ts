import { afterEach, expect, it, vi } from 'vitest';
import { checkMedia } from './media';

afterEach(() => vi.unstubAllGlobals());

it('probes a bounded range and cancels the body without buffering media', async () => {
  const cancel = vi.fn(async () => {});
  const fetch = vi.fn(async () => ({ ok: true, status: 206, headers: new Headers({ 'Content-Type': 'application/pdf' }), body: { cancel } }));
  vi.stubGlobal('fetch', fetch);
  await checkMedia('/api/files/test.pdf?preview=1', undefined, 'application/pdf');
  expect(fetch.mock.calls[0]).toEqual(['/api/files/test.pdf?preview=1', expect.objectContaining({ headers: { Range: 'bytes=0-0' }, cache: 'no-store' })]);
  expect(cancel).toHaveBeenCalledOnce();
});

it('notifies the access gate when a native media request loses authentication', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'AUTH_REQUIRED' }), { status: 401 })));
  const lock = vi.fn();
  window.addEventListener('gothrough:auth-required', lock);
  try {
    await expect(checkMedia('/api/files/test.png?preview=1')).rejects.toThrow();
    expect(lock).toHaveBeenCalledOnce();
  } finally { window.removeEventListener('gothrough:auth-required', lock); }
});

it('rejects HTTP errors and HTML fallbacks before embedding a PDF', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 }))
    .mockResolvedValueOnce(new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }));
  vi.stubGlobal('fetch', fetch);
  await expect(checkMedia('/test.pdf', undefined, 'application/pdf')).rejects.toThrow();
  await expect(checkMedia('/test.pdf', undefined, 'application/pdf')).rejects.toThrow();
});
