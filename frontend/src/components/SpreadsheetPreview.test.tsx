import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { EditorDraftProvider } from '@/contexts/EditorDraftProvider';
import { getSpreadsheetPreview, getSpreadsheetSaveStatus, saveSpreadsheetOperation, type SpreadsheetSaveResult, type SpreadsheetPreview as Workbook } from '@/services/files';
import SpreadsheetPreview from './SpreadsheetPreview';
import { AxiosError } from 'axios';
import { useState } from 'react';

vi.mock('@/services/files', async original => ({ ...await original<typeof import('@/services/files')>(), getSpreadsheetPreview: vi.fn(), getSpreadsheetSaveStatus: vi.fn(), saveSpreadsheetOperation: vi.fn() }));
const fixture = (): Workbook => ({ kind: 'spreadsheet', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', text: '', version: 'v1', sheets: [
  { name: 'Sheet1', rows: 30, columns: 2, read_only: false, cells: { A1: { value: '<script>text</script>', raw: '<script>text</script>', type: 'text' }, B1: { value: '12.00', raw: '12', type: 'number' }, C1: { value: '24', raw: '24', type: 'readonly', formula: 'B1*2' } } },
  { name: '预算', rows: 1, columns: 1, read_only: false, cells: { A1: { value: 'other', raw: 'other', type: 'text' } } },
] });

function openPreview() {
  const onClose = vi.fn();
  const router = createMemoryRouter([{ path: '/files', element: <SpreadsheetPreview name="book.xlsx" onClose={onClose} /> }, { path: '/other', element: <p>other page</p> }], { initialEntries: ['/files'] });
  const view = render(<EditorDraftProvider><RouterProvider router={router} /></EditorDraftProvider>);
  return { router, onClose, ...view };
}
beforeEach(() => { vi.mocked(getSpreadsheetPreview).mockResolvedValue(fixture()); vi.mocked(getSpreadsheetSaveStatus).mockResolvedValue({ status: 'unknown' }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('moves grid focus across page boundaries and opens the focused cell with Enter', async () => {
  openPreview();
  const readonly = await screen.findByRole('button', { name: '选择单元格 C1' });
  readonly.focus(); fireEvent.keyDown(readonly, { key: 'Enter' });
  expect(screen.queryByLabelText('单元格内容')?.hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
  const number = screen.getByRole('button', { name: '选择单元格 B1' });
  number.focus(); fireEvent.keyDown(number, { key: 'Enter' });
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('12');
  expect(document.activeElement).toBe(screen.getByLabelText('单元格内容'));
  fireEvent.click(readonly);
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).disabled).toBe(true);
  number.focus(); fireEvent.keyDown(number, { key: 'Enter' });
  expect(document.activeElement).toBe(screen.getByLabelText('单元格内容'));
  fireEvent.change(screen.getByLabelText('单元格地址'), { target: { value: 'A25' } });
  const last = screen.getByRole('button', { name: '选择单元格 A25' });
  last.focus(); fireEvent.keyDown(last, { key: 'ArrowDown' });
  const next = screen.getByRole('button', { name: '选择单元格 A26' });
  expect(document.activeElement).toBe(next);
  expect((screen.getByLabelText('单元格地址') as HTMLInputElement).value).toBe('A26');
  fireEvent.keyDown(next, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(next);
  fireEvent.keyDown(next, { key: 'Enter' });
  const input = screen.getByLabelText('单元格内容');
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect((screen.getByLabelText('单元格地址') as HTMLInputElement).value).toBe('A26');
  fireEvent.change(input, { target: { value: 'keyboard edit' } });
  const updated = fixture();
  vi.mocked(saveSpreadsheetOperation).mockResolvedValue({ status: 'saved', version: updated.version, preview: updated });
  fireEvent.keyDown(input, { key: 's', metaKey: true });
  await screen.findByText('文件已保存');
  expect(saveSpreadsheetOperation).toHaveBeenCalledWith('book.xlsx', expect.objectContaining({ version: 'v1', changes: [{ sheet: 'Sheet1', cell: 'A26', type: 'text', value: 'keyboard edit' }] }));
});

it('compares only changed cells and preserves a conflicted workbook draft', async () => {
  openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '选择单元格 B1' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: '23' } });
  const conflict = new AxiosError('conflict');
  conflict.response = { data: { code: 'TEXT_CONFLICT' }, status: 409, statusText: '', headers: {}, config: {} as never };
  vi.mocked(saveSpreadsheetOperation).mockRejectedValue(conflict);
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  const latest = fixture(); latest.version = 'v2'; latest.sheets[0].cells.B1.raw = '99';
  vi.mocked(getSpreadsheetPreview).mockResolvedValue(latest);
  fireEvent.click(screen.getByRole('button', { name: '对比最新内容' }));
  const backup = screen.getByRole('region', { name: '草稿备份与对比' });
  await within(backup).findByText('99');
  expect([...backup.querySelectorAll('pre')].map(element => element.textContent)).toEqual(['12', '23', '99']);
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('23');
  fireEvent.keyDown(screen.getByLabelText('单元格内容'), { key: 's', ctrlKey: true });
  expect(saveSpreadsheetOperation).toHaveBeenCalledOnce();
  expect(vi.mocked(saveSpreadsheetOperation).mock.calls[0][1].version).toBe('v1');
});

it('previews sheets safely, pages rows and saves typed changes across worksheets', async () => {
  const result = fixture(); result.version = 'v2'; result.sheets[0].cells.B1 = { value: '23.00', raw: '23', type: 'number' };
  vi.mocked(saveSpreadsheetOperation).mockResolvedValue({ status: 'saved', version: result.version, preview: result });
  const view = openPreview();
  expect((await screen.findByRole('button', { name: '选择单元格 A1' })).textContent).toBe('<script>text</script>');
  expect(view.container.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByRole('button', { name: '选择单元格 A26' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '选择单元格 B1' }));
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('12');
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: '23' } });
  fireEvent.change(screen.getByLabelText('工作表'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: '00123' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('文件已保存');
  expect(saveSpreadsheetOperation).toHaveBeenCalledWith('book.xlsx', expect.objectContaining({ id: expect.any(String), version: 'v1', changes: [{ sheet: 'Sheet1', cell: 'B1', type: 'number', value: '23' }, { sheet: '预算', cell: 'A1', type: 'text', value: '00123' }] }));
  // The success message can commit before the provider's passive effect removes
  // unload protection. Observe cleanup, using a fresh event for each probe.
  await waitFor(() => {
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });
});

it('keeps invalid values and conflicts without losing drafts, and confirms discards', async () => {
  const conflict = new AxiosError('conflict');
  conflict.response = { data: { code: 'TEXT_CONFLICT' }, status: 409, statusText: '', headers: {}, config: {} as never };
  vi.mocked(saveSpreadsheetOperation).mockRejectedValue(conflict);
  const { onClose } = openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '选择单元格 B1' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'invalid' } });
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: '23' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText(/文件已被其他操作修改/);
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('23');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true, bubbles: true }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重新加载工作簿' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
  await screen.findByRole('button', { name: '编辑' });
  expect(getSpreadsheetPreview).toHaveBeenCalledTimes(2);
});

it('locks formula cells and protects unsaved changes during navigation and saves', async () => {
  let finish!: (value: SpreadsheetSaveResult) => void;
  vi.mocked(saveSpreadsheetOperation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { router } = openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '选择单元格 C1' }));
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '选择单元格 A1' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'draft' } });
  await act(async () => { await router.navigate('/other'); });
  expect(router.state.location.pathname).toBe('/files');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await act(async () => { await router.navigate('/other'); });
  expect((screen.getByRole('button', { name: '放弃修改' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish({ status: 'saved', version: 'v1', preview: fixture() }); });
  await screen.findByText('other page');
});

it('locates empty distant cells and reviews, jumps to, and undoes changes across sheets', async () => {
  openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  // Keep jsdom's grid small; Playwright covers the full-width CV100 boundary.
  fireEvent.change(screen.getByLabelText('单元格地址'), { target: { value: 'J100' } });
  expect(screen.getByText('第 4 / 4 页')).toBeTruthy();
  expect(screen.getByRole('button', { name: '选择单元格 J100' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: '<b>safe text</b>' } });
  fireEvent.change(screen.getByLabelText('工作表'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'second edit' } });
  const list = screen.getByRole('region', { name: '修改清单' });
  expect(within(list).getByText('<b>safe text</b>')).toBeTruthy();
  expect(list.querySelector('b')).toBeNull();
  fireEvent.click(within(list).getByRole('button', { name: 'Sheet1!J100' }));
  expect((screen.getByLabelText('工作表') as HTMLSelectElement).value).toBe('0');
  expect((screen.getByLabelText('单元格地址') as HTMLInputElement).value).toBe('J100');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '选择单元格 J100' }));
  fireEvent.click(within(list).getByRole('button', { name: '撤销 预算!A1 的修改' }));
  expect(within(list).queryByText('second edit')).toBeNull();
  expect(within(list).getByText('<b>safe text</b>')).toBeTruthy();
});

it('confirms a lost save response without submitting the edits again', async () => {
  vi.mocked(saveSpreadsheetOperation).mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
  const latest = fixture(); latest.version = 'v2';
  vi.mocked(getSpreadsheetSaveStatus).mockResolvedValue({ status: 'saved', version: 'v2' });
  openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  vi.mocked(getSpreadsheetPreview).mockResolvedValue(latest);
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'saved edit' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('文件已保存');
  expect(saveSpreadsheetOperation).toHaveBeenCalledOnce();
  expect(getSpreadsheetSaveStatus).toHaveBeenCalledWith('book.xlsx', vi.mocked(saveSpreadsheetOperation).mock.calls[0][1].id, expect.anything());
});

it('keeps uncertain edits locked and retries exactly the original operation after an unknown status', async () => {
  vi.mocked(saveSpreadsheetOperation).mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'));
  openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'keep this edit' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText(/保存结果尚未确认/);
  expect((screen.getByLabelText('单元格内容') as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '撤销 Sheet1!A1 的修改' }) as HTMLButtonElement).disabled).toBe(true);
  const original = vi.mocked(saveSpreadsheetOperation).mock.calls[0][1];
  const latest = fixture(); latest.version = 'v2';
  vi.mocked(saveSpreadsheetOperation).mockResolvedValue({ status: 'saved', version: 'v2', preview: latest });
  fireEvent.click(screen.getByRole('button', { name: '确认保存结果' }));
  await screen.findByText('文件已保存');
  expect(saveSpreadsheetOperation).toHaveBeenLastCalledWith('book.xlsx', original);
  expect(saveSpreadsheetOperation).toHaveBeenCalledTimes(2);
});

it('retains a confirmed receipt when preview loading fails and only reloads on retry', async () => {
  const latest = fixture(); latest.version = 'v3';
  vi.mocked(getSpreadsheetPreview).mockResolvedValueOnce(fixture()).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(latest);
  vi.mocked(saveSpreadsheetOperation).mockResolvedValue({ status: 'saved', version: 'v2' });
  openPreview();
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'saved change' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText(/保存已确认，但无法读取最新预览/);
  fireEvent.click(screen.getByRole('button', { name: '确认保存结果' }));
  await screen.findByText('文件已保存');
  expect(screen.getByText(/文件随后发生了其他修改/)).toBeTruthy();
  expect(saveSpreadsheetOperation).toHaveBeenCalledOnce();
  expect(getSpreadsheetSaveStatus).not.toHaveBeenCalled();
});

it('restores an uncertain save operation after locking and confirms it without another write', async () => {
  vi.mocked(saveSpreadsheetOperation).mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
  const router = createMemoryRouter([{ path: '*', element: <SpreadsheetPreview name="book.xlsx" onClose={vi.fn()} /> }]);
  function Harness() {
    const [unlocked, setUnlocked] = useState(true);
    return <EditorDraftProvider><button onClick={() => setUnlocked(!unlocked)}>Toggle lock</button>{unlocked && <RouterProvider router={router} />}</EditorDraftProvider>;
  }
  render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'saved change' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText(/保存结果尚未确认/);
  const attempt = vi.mocked(saveSpreadsheetOperation).mock.calls[0][1];
  fireEvent.click(screen.getByRole('button', { name: 'Toggle lock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle lock' }));
  expect((await screen.findByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('saved change');
  expect(getSpreadsheetPreview).toHaveBeenCalledOnce();
  const latest = fixture(); latest.version = 'v2';
  vi.mocked(getSpreadsheetPreview).mockResolvedValue(latest);
  vi.mocked(getSpreadsheetSaveStatus).mockResolvedValue({ status: 'saved', version: 'v2' });
  fireEvent.click(screen.getByRole('button', { name: '确认保存结果' }));
  await screen.findByText('文件已保存');
  expect(saveSpreadsheetOperation).toHaveBeenCalledOnce();
  expect(vi.mocked(getSpreadsheetSaveStatus).mock.calls.at(-1)?.slice(0, 2)).toEqual(['book.xlsx', attempt.id]);
});

it('restores a workbook draft and its original version after remount', async () => {
  const onClose = vi.fn();
  const router = createMemoryRouter([{ path: '*', element: <SpreadsheetPreview name="book.xlsx" onClose={onClose} /> }]);
  function Harness() {
    const [unlocked, setUnlocked] = useState(true);
    return <EditorDraftProvider><button onClick={() => setUnlocked(!unlocked)}>Toggle lock</button>{unlocked && <RouterProvider router={router} />}</EditorDraftProvider>;
  }
  const view = render(<Harness />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('单元格内容'), { target: { value: 'draft' } });
  // Unmount only the editor, retaining the provider just as the access gate does.
  fireEvent.click(screen.getByRole('button', { name: 'Toggle lock' }));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle lock' }));
  expect((await screen.findByLabelText('单元格内容') as HTMLTextAreaElement).value).toBe('draft');
  expect(getSpreadsheetPreview).toHaveBeenCalledTimes(1);
  view.unmount();
});
