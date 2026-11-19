import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { useEditorDraft } from '@/contexts/EditorDraftContext';
import { createTextSaveAttempt, downloadFileUrl, getFilePreview, getTextSaveStatus, previewFileUrl, saveTextOperation, type FilePreviewInfo, type TextSaveAttempt, type TextSaveResult } from '@/services/files';
import { isAxiosError } from 'axios';
import { apiErrorDescriptor, getErrorBody } from '@/services/errors';
import { message, translateMessage, type Message } from '@/i18n/messages';
import { Button } from './ui/button';
import { PreviewDialog } from './PreviewDialog';
import { MediaPreview } from './MediaPreview';
import { ConfirmPanel } from './ConfirmActions';
import { RefreshButton } from './RefreshButton';
import { StatusMessage } from './StatusMessage';
import './FilePreview.css';
import { lazy, Suspense } from 'react';

const SpreadsheetPreview = lazy(() => import('./SpreadsheetPreview'));

export function FilePreview({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  return name.toLowerCase().endsWith('.xlsx')
    ? <Suspense fallback={<PreviewDialog title={name} downloadUrl={downloadFileUrl(name)} onClose={onClose}><StatusMessage tone="loading">{t('preview.loading')}</StatusMessage></PreviewDialog>}><SpreadsheetPreview name={name} onClose={onClose} onSaved={onSaved} /></Suspense>
    : <TextMediaPreview name={name} onClose={onClose} onSaved={onSaved} />;
}

function TextMediaPreview({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const preserved = useEditorDraft();
  const [restored] = useState(() => preserved.draft?.name === name && preserved.draft.kind !== 'spreadsheet' ? preserved.draft : null);
  const [info, setInfo] = useState<FilePreviewInfo | null>(() => restored?.info ?? null);
  const [error, setError] = useState<Message>('');
  const [editing, setEditing] = useState(() => restored !== null);
  const [draft, setDraft] = useState(() => restored?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editError, setEditError] = useState<Message>('');
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedThenChanged, setSavedThenChanged] = useState(false);
  const [operation, setOperation] = useState<TextSaveAttempt | undefined>(() => restored?.operation);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pendingAction, setPendingAction] = useState<'close' | 'cancel' | 'reload' | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const reloadRequest = useRef<AbortController | null>(null);
  const dirty = editing && (draft !== info?.text || !!operation);
  const draftBytes = new TextEncoder().encode(draft).length;
  const blocker = useBlocker(dirty || saving);
  const navigationBlocked = blocker.state === 'blocked';
  const hasPendingAction = navigationBlocked || pendingAction !== null;

  useEffect(() => {
    // If a pending save succeeds, the blocked navigation no longer loses edits.
    if (blocker.state === 'blocked' && !dirty && !saving) blocker.proceed();
  }, [blocker, dirty, saving]);

  useEffect(() => {
    if (editing && !hasPendingAction) editor.current?.focus();
  }, [editing, hasPendingAction]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; reloadRequest.current?.abort(); };
  }, []);

  function performAction(action: 'close' | 'cancel' | 'reload') {
    if (action === 'close') { preserved.discard(name); onClose(); }
    else if (action === 'reload') void reload();
    else { preserved.discard(name); setOperation(undefined); setEditing(false); setEditError(''); }
  }
  function requestAction(action: 'close' | 'cancel' | 'reload') {
    if (busy.current || reloading) return;
    if (dirty) setPendingAction(action);
    else performAction(action);
  }
  function close() {
    if (navigationBlocked) { blocker.reset(); setPendingAction(null); }
    else if (pendingAction) setPendingAction(null);
    else requestAction('close');
  }

  function confirmDiscard() {
    if (navigationBlocked) {
      preserved.discard(name);
      setPendingAction(null);
      blocker.proceed();
    } else if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      performAction(action);
    }
  }

  function keepEditing() {
    if (navigationBlocked) blocker.reset();
    setPendingAction(null);
  }

  async function save() {
    if (busy.current || hasPendingAction || !info?.version || (!operation && (draftBytes > 1048576 || conflict))) return;
    const attempt = operation ?? createTextSaveAttempt(info.version, draft);
    const remember = (next?: TextSaveAttempt) => preserved.remember({ name, info, text: draft, operation: next });
    setOperation(attempt); remember(attempt);
    const controller = new AbortController();
    reloadRequest.current?.abort(); reloadRequest.current = controller;
    busy.current = true; setSaving(true); setEditError(''); setSaved(false);
    const confirmation: { version?: string; phase: 'write' | 'status' | 'preview' } = { version: attempt.confirmedVersion, phase: operation ? 'status' : 'write' };
    const accept = async (result: TextSaveResult) => {
      if (result.status !== 'saved' || !result.version) throw new Error('Invalid save receipt');
      confirmation.version = result.version; confirmation.phase = 'preview';
      if (!alive.current) return;
      const receipt = { ...attempt, confirmedVersion: result.version };
      setOperation(receipt); remember(receipt);
      const snapshot = await getFilePreview(name, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      if (snapshot.kind !== 'text' || !snapshot.version) throw new Error('Invalid text preview');
      preserved.discard(name); setOperation(undefined); setInfo(snapshot); setDraft(snapshot.text);
      setEditing(false); setConflict(false); setSaved(true); setSavedThenChanged(snapshot.version !== result.version); onSaved?.();
    };
    try {
      let result: TextSaveResult;
      if (confirmation.version) result = { status: 'saved', version: confirmation.version };
      else if (operation) {
        result = await getTextSaveStatus(name, attempt.id, controller.signal);
        if (!alive.current) return;
        if (result.status === 'unknown') { confirmation.phase = 'write'; result = await saveTextOperation(name, attempt); }
      } else result = await saveTextOperation(name, attempt);
      if (result.status === 'saved') await accept(result);
    } catch (reason) {
      if (!alive.current) return;
      if (confirmation.version) { setEditError(message('edit.savedPreviewUnavailable')); return; }
      const status = isAxiosError(reason) ? reason.response?.status : undefined;
      if (confirmation.phase === 'write' && status && status < 500 && status !== 408 && status !== 429) {
        setOperation(undefined); remember(); setEditError(apiErrorDescriptor(reason));
        const code = getErrorBody<{ code?: string }>(reason)?.code;
        setConflict(code === 'TEXT_CONFLICT' || code === 'TEXT_OPERATION_CONFLICT');
      } else {
        try {
          const result = await getTextSaveStatus(name, attempt.id, controller.signal);
          if (result.status === 'saved') await accept(result);
        } catch { if (alive.current && confirmation.version) setEditError(message('edit.savedPreviewUnavailable')); }
      }
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }

  async function reload() {
    if (busy.current || reloading) return;
    const controller = new AbortController();
    reloadRequest.current = controller;
    setReloading(true); setEditError('');
    try {
      const result = await getFilePreview(name, controller.signal);
      if (!alive.current) return;
      preserved.discard(name);
      setOperation(undefined); setInfo(result); setDraft(result.text); setEditing(false); setConflict(false); setSaved(false);
    } catch (reason) {
      if (alive.current) setEditError(apiErrorDescriptor(reason));
    } finally { if (alive.current) setReloading(false); }
  }

  useEffect(() => {
    // Do not replace a restored draft's base version with a fresh server version:
    // another device may have edited the file while this session was locked.
    if (restored) return;
    const controller = new AbortController();
    void getFilePreview(name, controller.signal).then(result => {
      if (!controller.signal.aborted) setInfo(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(apiErrorDescriptor(reason));
    });
    return () => controller.abort();
  }, [name, restored, loadAttempt]);

  const url = previewFileUrl(name);
  return <PreviewDialog title={name} downloadUrl={downloadFileUrl(name)} busy={saving || reloading} onClose={close}>
      {hasPendingAction && <ConfirmPanel message={t(operation ? 'edit.discardUnconfirmed' : 'edit.discard')} disabled={saving || reloading} confirmLabel={t('edit.discardConfirm')} cancelLabel={t('edit.keepEditing')} onConfirm={confirmDiscard} onCancel={keepEditing} />}
      {error ? <StatusMessage tone="error" action={<Button variant="outline" onClick={() => { setError(''); setLoadAttempt(value => value + 1); }}>{t('preview.retry')}</Button>}>{translateMessage(error)}</StatusMessage> : !info ? <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage> : <>
        {info.kind === 'text' && <>
          <div className="file-editor-toolbar">
            {editing ? <>
              <Button disabled={saving || reloading || hasPendingAction || (!operation && (!dirty || conflict || draftBytes > 1048576))} onClick={() => void save()}>{t(saving ? 'edit.saving' : operation ? 'edit.confirmSave' : 'edit.save')}</Button>
              <Button variant="outline" disabled={saving || reloading || hasPendingAction} onClick={() => requestAction('cancel')}>{t('edit.cancel')}</Button>
              <span>{t('edit.bytes', { count: draftBytes })}</span>
            </> : <Button variant="outline" disabled={!info.version || reloading} onClick={() => { setDraft(info.text); setEditing(true); setEditError(''); setSaved(false); }}>{t('edit.button')}</Button>}
            {conflict && <RefreshButton loading={reloading} disabled={saving || hasPendingAction} onClick={() => requestAction('reload')} label={t('edit.reload')} />}
          </div>
          {editError && <StatusMessage tone="error">{translateMessage(editError)}</StatusMessage>}
          {saved && <StatusMessage tone="success">{t('edit.saved')}</StatusMessage>}
          {saved && savedThenChanged && <StatusMessage>{t('edit.savedThenChanged')}</StatusMessage>}
          {operation && !saving && (!editError || !operation.confirmedVersion) && <StatusMessage>{t(operation.confirmedVersion ? 'edit.savedPreviewUnavailable' : 'edit.unconfirmed')}</StatusMessage>}
          {editing ? <>
            <label className="sr-only" htmlFor="file-editor-text">{t('edit.content')}</label>
            <textarea ref={editor} id="file-editor-text" className="file-editor-text" spellCheck={false} value={draft} disabled={saving || reloading || hasPendingAction || !!operation} aria-invalid={draftBytes > 1048576} onChange={event => { setDraft(event.target.value); if (info) preserved.remember({ name, info, text: event.target.value }); }} />
            {draftBytes > 1048576 && <StatusMessage tone="error">{t('errors.TEXT_TOO_LARGE')}</StatusMessage>}
          </> : <pre>{info.text}</pre>}
        </>}
        {info.kind !== 'text' && info.kind !== 'spreadsheet' && <MediaPreview key={url} kind={info.kind} url={url} name={name} />}
      </>}
  </PreviewDialog>;
}
