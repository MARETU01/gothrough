import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { AccessGate } from './AccessGate';
import { EditorDraftProvider } from '@/contexts/EditorDraftProvider';
import FilesPage from '@/pages/Files/FilesPage';
import { getFilePreview, saveFileText } from '@/services/files';
import { responseApi } from '@/services/http';
import { AxiosError } from 'axios';

vi.mock('@/services/http', () => ({ responseApi: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/services/files', () => ({
  listFiles: vi.fn(async () => ({ files: [{ name: 'edit.txt', size: 3, size_display: '3 B', mtime: '2026-11-07T00:00:00Z' }], total_size_display: '3 B' })),
  getDiskInfo: vi.fn(async () => ({ disk_pct: 0, disk_pct_warning: false, disk_free_display: '1 GB', disk_used_display: '0 B', disk_total_display: '1 GB' })),
  getFilePreview: vi.fn(), saveFileText: vi.fn(), deleteSelection: vi.fn(),
  downloadFileUrl: (name: string) => '/api/files/' + name,
  previewFileUrl: (name: string) => '/api/files/' + name + '?preview=1',
  downloadSelectionUrl: vi.fn(() => '/api/batch-download'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(responseApi.get).mockResolvedValue({ data: { enabled: true, authenticated: true } });
  vi.mocked(responseApi.post).mockResolvedValue({ data: { enabled: true, authenticated: true } });
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'old', version: 'v1' });
});
afterEach(cleanup);

async function openEditor() {
  const router = createMemoryRouter([{ element: <AccessGate><Outlet /></AccessGate>, children: [
    { path: '/files', element: <FilesPage /> }, { path: '/other', element: <h1>Other page</h1> },
  ] }], { initialEntries: ['/other', '/files'], initialIndex: 1 });
  render(<EditorDraftProvider><RouterProvider router={router} /></EditorDraftProvider>);
  fireEvent.click(await screen.findByRole('button', { name: '预览 edit.txt' }));
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByRole('textbox', { name: '文件内容' }), { target: { value: 'my draft' } });
  return router;
}

it('blocks browser-style back navigation, keeps edits on cancel, and discards only after confirmation', async () => {
  const router = await openEditor();
  await act(async () => { await router.navigate(-1); });
  expect(router.state.location.pathname).toBe('/files');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my draft');
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await screen.findByText('Other page');
  await act(async () => { await router.navigate('/files'); });
  await screen.findByText('edit.txt');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('restores an expired-session draft with its original version and keeps unload protection while locked', async () => {
  await openEditor();
  vi.mocked(saveFileText).mockImplementationOnce(async () => {
    window.dispatchEvent(new Event('gothrough:auth-required'));
    throw new Error('expired');
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  const password = await screen.findByLabelText('访问口令');
  expect(screen.getByText('编辑草稿已保留，重新解锁后可继续编辑。')).toBeTruthy();
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  vi.mocked(getFilePreview).mockResolvedValue({ kind: 'text', mime_type: 'text/plain', text: 'other device', version: 'v2' });
  fireEvent.change(password, { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: '解锁空间' }));
  const editor = await screen.findByRole('textbox', { name: '文件内容' });
  expect((editor as HTMLTextAreaElement).value).toBe('my draft');
  expect(getFilePreview).toHaveBeenCalledTimes(1);
  const conflict = new AxiosError('conflict');
  conflict.response = { status: 409, statusText: '', headers: {}, config: {} as never, data: { code: 'TEXT_CONFLICT' } };
  vi.mocked(saveFileText).mockRejectedValueOnce(conflict);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(saveFileText).toHaveBeenLastCalledWith('edit.txt', 'my draft', 'v1'));
  expect((await screen.findByRole('alert')).textContent).toContain('文件已被其他操作修改');
});

it('waits for an in-flight save before allowing blocked navigation to proceed', async () => {
  const router = await openEditor();
  let finish!: (value: { version: string }) => void;
  vi.mocked(saveFileText).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await act(async () => { await router.navigate(-1); });
  expect((screen.getByRole('button', { name: '放弃修改' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish({ version: 'v2' }); });
  await screen.findByText('Other page');
  expect(router.state.location.pathname).toBe('/other');
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(false);
});
