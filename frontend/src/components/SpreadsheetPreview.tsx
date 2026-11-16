import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { useEditorDraft } from '@/contexts/EditorDraftContext';
import { createSpreadsheetSaveAttempt, downloadFileUrl, getSpreadsheetPreview, getSpreadsheetSaveStatus, saveSpreadsheetOperation, type SpreadsheetChange, type SpreadsheetSaveAttempt, type SpreadsheetSaveResult, type SpreadsheetPreview as Workbook } from '@/services/files';
import { isAxiosError } from 'axios';
import { apiErrorDescriptor, getErrorBody } from '@/services/errors';
import { message, translateMessage, type Message } from '@/i18n/messages';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { ConfirmPanel } from './ConfirmActions';
import { PreviewDialog } from './PreviewDialog';
import { StatusMessage } from './StatusMessage';
import './SpreadsheetPreview.css';

const pageSize = 25;
function columnName(index: number): string {
  let result = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function coordinate(address: string) {
  const match = /^([A-Z]{1,2})([1-9]\d{0,3})$/.exec(address);
  if (!match) return null;
  const col = [...match[1]].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  return col <= 100 && row <= 2000 ? { col, row } : null;
}
function validChange(change: SpreadsheetChange) {
  if (new TextEncoder().encode(change.value).length > 16384 || [...change.value].some(char => char.charCodeAt(0) < 32 && !'\t\n\r'.includes(char))) return false;
  if (change.type === 'number') return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(change.value) && Number.isFinite(Number(change.value));
  if (change.type === 'boolean') return change.value === 'true' || change.value === 'false';
  return true;
}

export default function SpreadsheetPreview({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const preserved = useEditorDraft();
  const [restored] = useState(() => preserved.draft?.name === name && preserved.draft.kind === 'spreadsheet' ? preserved.draft : null);
  const [book, setBook] = useState<Workbook | null>(() => restored?.info ?? null);
  const [changes, setChanges] = useState<SpreadsheetChange[]>(() => restored?.changes ?? []);
  const [operation, setOperation] = useState<SpreadsheetSaveAttempt | undefined>(() => restored?.operation);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [address, setAddress] = useState('A1');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(!!restored);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!restored);
  const [error, setError] = useState<Message>('');
  const [saved, setSaved] = useState(false);
  const [savedThenChanged, setSavedThenChanged] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<'close' | 'cancel' | 'reload' | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const cellInput = useRef<HTMLTextAreaElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusLocatedCell = useRef(false);
  const dirty = changes.length > 0;
  const blocker = useBlocker(dirty || saving);
  const navigationBlocked = blocker.state === 'blocked';
  const blocked = navigationBlocked || pending !== null;
  const sheet = book?.sheets[sheetIndex];
  const cell = address.trim().toUpperCase();
  const validAddress = coordinate(cell);
  const original = sheet?.cells[cell];
  const selectedChange = changes.find(change => change.sheet === sheet?.name && change.cell === cell);
  const cellType = selectedChange?.type ?? (original?.type === 'readonly' ? 'text' : original?.type ?? 'text');
  const cellValue = selectedChange?.value ?? original?.raw ?? '';
  const editable = editing && validAddress && !sheet?.read_only && original?.type !== 'readonly' && !saving && !loading && !blocked && !operation;
  const invalid = changes.some(change => !validChange(change));
  const sheetChanges = changes.filter(change => change.sheet === sheet?.name);
  const rowCount = Math.max(20, sheet?.rows ?? 0, validAddress?.row ?? 0, ...sheetChanges.map(change => coordinate(change.cell)!.row));
  const columnCount = Math.max(8, sheet?.columns ?? 0, validAddress?.col ?? 0, ...sheetChanges.map(change => coordinate(change.cell)!.col));
  const pages = Math.ceil(rowCount / pageSize);
  const currentPage = Math.min(page, pages);
  const columns = Array.from({ length: columnCount }, (_, index) => columnName(index + 1));

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (blocker.state === 'blocked' && !dirty && !saving) blocker.proceed();
  }, [blocker, dirty, saving]);
  useEffect(() => { if (editing && !blocked) cellInput.current?.focus(); }, [editing, blocked]);
  useEffect(() => {
    if (!coordinate(cell)) return;
    const element = grid.current?.querySelector<HTMLButtonElement>(`button[data-cell="${cell}"]`);
    if (!element) return;
    element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (focusLocatedCell.current) { element.focus({ preventScroll: true }); focusLocatedCell.current = false; }
  }, [cell, sheetIndex, currentPage, book]);
  useEffect(() => {
    if (restored) return;
    const controller = new AbortController();
    request.current = controller;
    void getSpreadsheetPreview(name, controller.signal).then(result => {
      if (!controller.signal.aborted) setBook(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(apiErrorDescriptor(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [name, restored]);

  function rememberDraft(next: SpreadsheetChange[], attempt?: SpreadsheetSaveAttempt) {
    if (book) preserved.remember({ kind: 'spreadsheet', name, info: book, text: '', changes: next, operation: attempt });
  }
  function locate(sheetName: string, ref: string, focus = false) {
    const index = book?.sheets.findIndex(item => item.name === sheetName) ?? -1;
    const position = coordinate(ref);
    if (index < 0 || !position) return;
    focusLocatedCell.current = focus; setSheetIndex(index); setAddress(ref); setPage(Math.ceil(position.row / pageSize));
    if (focus && index === sheetIndex && ref === cell && Math.ceil(position.row / pageSize) === currentPage) {
      const element = grid.current?.querySelector<HTMLButtonElement>(`button[data-cell="${ref}"]`);
      element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      element?.focus({ preventScroll: true }); focusLocatedCell.current = false;
    }
  }
  function updateChanges(next: SpreadsheetChange[]) {
    if (operation) return;
    setChanges(next); setSaved(false);
    rememberDraft(next);
  }
  function changeCell(type: SpreadsheetChange['type'], value: string) {
    if (!editable || !sheet) return;
    const next = changes.filter(change => change.sheet !== sheet.name || change.cell !== cell);
    const unchanged = type === (original?.type ?? 'text') && value === (original?.raw ?? '') || type === 'clear' && !original;
    if (!unchanged) next.push({ sheet: sheet.name, cell, type, value });
    if (next.length > 100) { setError(message('sheet.changeLimit')); return; }
    updateChanges(next);
  }
  async function reload() {
    if (busy.current) return;
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setLoading(true); setError('');
    try {
      const result = await getSpreadsheetPreview(name, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      preserved.discard(name); setOperation(undefined); setBook(result); setChanges([]); setEditing(false); setConflict(false); setSaved(false); setSheetIndex(0); setPage(1); setAddress('A1');
    } catch (reason) { if (alive.current && !controller.signal.aborted) setError(apiErrorDescriptor(reason)); }
    finally { if (alive.current && !controller.signal.aborted) setLoading(false); }
  }
  function perform(action: 'close' | 'cancel' | 'reload') {
    if (action === 'reload') { void reload(); return; }
    preserved.discard(name); setChanges([]); setOperation(undefined);
    if (action === 'close') onClose(); else { setEditing(false); setError(''); }
  }
  function requestAction(action: 'close' | 'cancel' | 'reload') {
    if (busy.current || loading) return;
    if (dirty) setPending(action); else perform(action);
  }
  function close() {
    if (navigationBlocked) blocker.reset();
    else if (pending) setPending(null);
    else if (loading && !busy.current) onClose();
    else requestAction('close');
  }
  async function save() {
    if (!book || busy.current || blocked || (!operation && (!dirty || invalid || conflict))) return;
    const attempt = operation ?? createSpreadsheetSaveAttempt(book.version, changes);
    setOperation(attempt); rememberDraft(changes, attempt);
    busy.current = true; setSaving(true); setError(''); setSaved(false);
    const confirmation: { version?: string; phase: 'write' | 'status' | 'preview' } = { version: attempt.confirmedVersion, phase: operation ? 'status' : 'write' };
    const accept = async (result: SpreadsheetSaveResult) => {
      if (result.status !== 'saved' || !result.version) throw new Error('Invalid save receipt');
      confirmation.version = result.version;
      confirmation.phase = 'preview';
      if (!alive.current) return;
      const receipt = { ...attempt, confirmedVersion: result.version };
      setOperation(receipt); rememberDraft(changes, receipt);
      const snapshot = result.preview ?? await getSpreadsheetPreview(name, request.current?.signal);
      if (!alive.current) return;
      if (result.preview && snapshot.version !== result.version) throw new Error('Invalid save preview');
      preserved.discard(name); setOperation(undefined); setBook(snapshot); setChanges([]); setEditing(false); setSaved(true); setSavedThenChanged(snapshot.version !== result.version); setConflict(false); onSaved?.();
    };
    try {
      let result: SpreadsheetSaveResult;
      if (confirmation.version) result = { status: 'saved', version: confirmation.version };
      else if (operation) {
        result = await getSpreadsheetSaveStatus(name, attempt.id, request.current?.signal);
        if (!alive.current) return;
        if (result.status === 'unknown') { confirmation.phase = 'write'; result = await saveSpreadsheetOperation(name, attempt); }
      } else result = await saveSpreadsheetOperation(name, attempt);
      if (result.status === 'saved') await accept(result);
    } catch (reason) {
      if (!alive.current) return;
      if (confirmation.version) { setError(message('sheet.savedPreviewUnavailable')); return; }
      const status = isAxiosError(reason) ? reason.response?.status : undefined;
      if (confirmation.phase === 'write' && status && status < 500 && status !== 408 && status !== 429) {
        setOperation(undefined); rememberDraft(changes); setError(apiErrorDescriptor(reason));
        const code = getErrorBody<{ code?: string }>(reason)?.code;
        setConflict(code === 'TEXT_CONFLICT' || code === 'SPREADSHEET_OPERATION_CONFLICT');
      } else {
        try {
          const result = await getSpreadsheetSaveStatus(name, attempt.id, request.current?.signal);
          if (result.status === 'saved') await accept(result);
        } catch { if (alive.current && confirmation.version) setError(message('sheet.savedPreviewUnavailable')); }
      }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  }

  return <PreviewDialog title={name} downloadUrl={downloadFileUrl(name)} busy={saving} onClose={close}>
    {blocked && <ConfirmPanel message={t(operation ? 'sheet.discardUnconfirmed' : 'edit.discard')} disabled={saving || loading} confirmLabel={t('edit.discardConfirm')} cancelLabel={t('edit.keepEditing')}
      onCancel={() => { if (navigationBlocked) blocker.reset(); setPending(null); }}
      onConfirm={() => {
        if (navigationBlocked) { preserved.discard(name); blocker.proceed(); }
        else if (pending) { const action = pending; setPending(null); perform(action); }
      }} />}
    {error && <StatusMessage tone="error">{translateMessage(error)}</StatusMessage>}
    {saved && <StatusMessage tone="success">{t('edit.saved')}</StatusMessage>}
    {saved && savedThenChanged && <StatusMessage>{t('sheet.savedThenChanged')}</StatusMessage>}
    {operation && !saving && (!error || !operation.confirmedVersion) && <StatusMessage>{t(operation.confirmedVersion ? 'sheet.savedPreviewUnavailable' : 'sheet.unconfirmed')}</StatusMessage>}
    {loading && <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>}
    {!book && !loading && <Button variant="outline" onClick={() => void reload()}>{t('sheet.reload')}</Button>}
    {book && sheet && <div className="spreadsheet-preview" aria-busy={saving || loading}>
      <p className="spreadsheet-hint">{t('sheet.hint')}</p>
      <div className="spreadsheet-toolbar">
        <label htmlFor={id + '-sheet'}>{t('sheet.worksheet')}</label><Select id={id + '-sheet'} value={sheetIndex} disabled={saving || loading || blocked} onChange={event => { setSheetIndex(Number(event.target.value)); setPage(1); setAddress('A1'); }}>{book.sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</Select>
        {editing ? <>
          <Button disabled={saving || loading || blocked || (!operation && (!dirty || invalid || conflict))} onClick={() => void save()}>{t(saving ? 'edit.saving' : operation ? 'sheet.confirmSave' : 'edit.save')}</Button>
          <Button variant="outline" disabled={saving || loading || blocked} onClick={() => requestAction('cancel')}>{t('edit.cancel')}</Button>
          <span>{t('sheet.changed', { count: changes.length })}</span>
        </> : <Button disabled={sheet.read_only || loading || blocked} onClick={() => { setEditing(true); setSaved(false); }}>{t('edit.button')}</Button>}
        <Button variant="outline" disabled={saving || loading || blocked} onClick={() => requestAction('reload')}>{t('sheet.reload')}</Button>
      </div>
      {sheet.read_only && <StatusMessage>{t('sheet.readOnly')}</StatusMessage>}
      {invalid && <StatusMessage tone="error">{t('sheet.invalidValue')}</StatusMessage>}
      <div ref={grid} className="spreadsheet-scroll" tabIndex={0} role="region" aria-label={t('sheet.grid')}>
        <table className="spreadsheet-grid"><thead><tr><th scope="col">#</th>{columns.map(col => <th key={col} scope="col">{col}</th>)}</tr></thead>
          <tbody>{Array.from({ length: Math.min(pageSize, rowCount - (currentPage - 1) * pageSize) }, (_, index) => {
            const row = (currentPage - 1) * pageSize + index + 1;
            return <tr key={row}><th scope="row">{row}</th>{columns.map(col => {
              const ref = col + row;
              const change = sheetChanges.find(item => item.cell === ref);
              const value = change ? change.type === 'clear' ? '' : change.value : sheet.cells[ref]?.value ?? '';
              return <td key={col} data-changed={!!change} data-selected={cell === ref}><button type="button" data-cell={ref} disabled={saving || loading || blocked} aria-label={t('sheet.selectCell', { cell: ref })} aria-pressed={cell === ref} onClick={() => setAddress(ref)}>{value || '\u00a0'}</button></td>;
            })}</tr>;
          })}</tbody>
        </table>
      </div>
      <div className="spreadsheet-toolbar">
        <Button variant="outline" disabled={currentPage <= 1 || saving || blocked} onClick={() => setPage(currentPage - 1)}>{t('sheet.previous')}</Button>
        <span>{t('sheet.page', { page: currentPage, pages })}</span>
        <Button variant="outline" disabled={currentPage >= pages || saving || blocked} onClick={() => setPage(currentPage + 1)}>{t('sheet.next')}</Button>
      </div>
      <div className="spreadsheet-editor">
        <div className="spreadsheet-field"><label htmlFor={id + '-address'}>{t('sheet.address')}</label><input id={id + '-address'} value={address} maxLength={6} disabled={saving || loading || blocked} aria-invalid={!validAddress} onChange={event => { const next = event.target.value.toUpperCase(); setAddress(next); const position = coordinate(next.trim()); if (position) setPage(Math.ceil(position.row / pageSize)); }} /></div>
        {!validAddress && <StatusMessage tone="error">{t('sheet.invalidAddress')}</StatusMessage>}
        <div className="spreadsheet-field"><label htmlFor={id + '-type'}>{t('sheet.cellType')}</label><Select id={id + '-type'} value={cellType} disabled={!editable} onChange={event => { const type = event.target.value as SpreadsheetChange['type']; changeCell(type, type === 'clear' ? '' : type === 'boolean' ? 'false' : cellValue); }}>
          <option value="text">{t('sheet.text')}</option><option value="number">{t('sheet.number')}</option><option value="boolean">{t('sheet.boolean')}</option><option value="clear">{t('sheet.clear')}</option>
        </Select></div>
        <div className="spreadsheet-field spreadsheet-value"><label htmlFor={id + '-value'}>{t('sheet.value')}</label><textarea id={id + '-value'} ref={cellInput} value={cellValue} disabled={!editable || cellType === 'clear'} spellCheck={false} aria-invalid={selectedChange ? !validChange(selectedChange) : false} onChange={event => changeCell(cellType, event.target.value)} /></div>
        {original?.formula && <p className="spreadsheet-formula">{t('sheet.formula', { formula: original.formula })}</p>}
        {cellType === 'number' && <p className="spreadsheet-hint">{t('sheet.numericHint')}</p>}
        {selectedChange && <Button variant="outline" disabled={saving || loading || blocked || !!operation} onClick={() => { updateChanges(changes.filter(change => change !== selectedChange)); cellInput.current?.focus(); }}>{t('sheet.undoCell')}</Button>}
      </div>
      {dirty && <section className="spreadsheet-changes" aria-label={t('sheet.changeList')}>
        <h3>{t('sheet.changeList')}</h3>
        <ul>{changes.map(change => {
          const base = book.sheets.find(item => item.name === change.sheet)?.cells[change.cell];
          return <li key={change.sheet + ':' + change.cell} data-invalid={!validChange(change)}>
            <div className="spreadsheet-change-actions"><Button variant="ghost" size="sm" disabled={saving || loading || blocked} onClick={() => locate(change.sheet, change.cell, true)}>{change.sheet}!{change.cell}</Button>
              <Button variant="outline" size="sm" disabled={saving || loading || blocked || !!operation} aria-label={t('sheet.undoChange', { sheet: change.sheet, cell: change.cell })} onClick={() => { updateChanges(changes.filter(item => item !== change)); grid.current?.focus({ preventScroll: true }); }}>{t('sheet.undo')}</Button></div>
            <div className="spreadsheet-diff"><div><span>{t('sheet.before')}</span><pre>{base?.raw || t('sheet.empty')}</pre></div><div><span>{t('sheet.after')} · {t('sheet.' + change.type)}</span><pre>{change.value || t('sheet.empty')}</pre></div></div>
          </li>;
        })}</ul>
      </section>}
    </div>}
  </PreviewDialog>;
}
