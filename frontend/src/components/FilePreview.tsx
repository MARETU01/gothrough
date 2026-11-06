import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFileUrl, getFilePreview, previewFileUrl, saveFileText, type FilePreviewInfo } from '@/services/files';
import { apiErrorDescriptor, getErrorBody } from '@/services/errors';
import { translateMessage, type Message } from '@/i18n/messages';
import { Button } from './ui/button';
import { PreviewDialog } from './PreviewDialog';
import { MediaPreview } from './MediaPreview';
import { ConfirmPanel } from './ConfirmActions';
import { RefreshButton } from './RefreshButton';
import { StatusMessage } from './StatusMessage';
import './FilePreview.css';

export function FilePreview({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<FilePreviewInfo | null>(null);
  const [error, setError] = useState<Message>('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editError, setEditError] = useState<Message>('');
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingAction, setPendingAction] = useState<'close' | 'cancel' | 'reload' | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const reloadRequest = useRef<AbortController | null>(null);
  const dirty = editing && draft !== info?.text;
  const draftBytes = new TextEncoder().encode(draft).length;

  useEffect(() => {
    if (editing && !pendingAction) editor.current?.focus();
  }, [editing, pendingAction]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; reloadRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  function performAction(action: 'close' | 'cancel' | 'reload') {
    if (action === 'close') onClose();
    else if (action === 'reload') void reload();
    else { setEditing(false); setEditError(''); }
  }
  function requestAction(action: 'close' | 'cancel' | 'reload') {
    if (busy.current || reloading) return;
    if (dirty) setPendingAction(action);
    else performAction(action);
  }
  function close() {
    if (pendingAction) setPendingAction(null);
    else requestAction('close');
  }

  async function save() {
    if (busy.current || !info?.version || draftBytes > 1048576) return;
    busy.current = true; setSaving(true); setEditError(''); setSaved(false);
    try {
      const result = await saveFileText(name, draft, info.version);
      if (!alive.current) return;
      setInfo({ ...info, text: draft, version: result.version });
      setEditing(false); setConflict(false); setSaved(true);
      onSaved?.();
    } catch (reason) {
      if (alive.current) {
        setEditError(apiErrorDescriptor(reason));
        setConflict(getErrorBody<{ code?: string }>(reason)?.code === 'TEXT_CONFLICT');
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
      setInfo(result); setDraft(result.text); setEditing(false); setConflict(false); setSaved(false);
    } catch (reason) {
      if (alive.current) setEditError(apiErrorDescriptor(reason));
    } finally { if (alive.current) setReloading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void getFilePreview(name, controller.signal).then(result => {
      if (!controller.signal.aborted) setInfo(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(apiErrorDescriptor(reason));
    });
    return () => controller.abort();
  }, [name]);

  const url = previewFileUrl(name);
  return <PreviewDialog title={name} downloadUrl={downloadFileUrl(name)} busy={saving || reloading} onClose={close}>
      {pendingAction && <ConfirmPanel message={t('edit.discard')} confirmLabel={t('edit.discardConfirm')} cancelLabel={t('edit.keepEditing')} onConfirm={() => { const action = pendingAction; setPendingAction(null); performAction(action); }} onCancel={() => setPendingAction(null)} />}
      {error ? <StatusMessage tone="error">{translateMessage(error)}</StatusMessage> : !info ? <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage> : <>
        {info.kind === 'text' && <>
          <div className="file-editor-toolbar">
            {editing ? <>
              <Button disabled={saving || reloading || !!pendingAction || !dirty || conflict || draftBytes > 1048576} onClick={() => void save()}>{t(saving ? 'edit.saving' : 'edit.save')}</Button>
              <Button variant="outline" disabled={saving || reloading || !!pendingAction} onClick={() => requestAction('cancel')}>{t('edit.cancel')}</Button>
              <span>{t('edit.bytes', { count: draftBytes })}</span>
            </> : <Button variant="outline" disabled={!info.version || reloading} onClick={() => { setDraft(info.text); setEditing(true); setEditError(''); setSaved(false); }}>{t('edit.button')}</Button>}
            {conflict && <RefreshButton loading={reloading} disabled={saving || !!pendingAction} onClick={() => requestAction('reload')} label={t('edit.reload')} />}
          </div>
          {editError && <StatusMessage tone="error">{translateMessage(editError)}</StatusMessage>}
          {saved && <StatusMessage tone="success">{t('edit.saved')}</StatusMessage>}
          {editing ? <>
            <label className="sr-only" htmlFor="file-editor-text">{t('edit.content')}</label>
            <textarea ref={editor} id="file-editor-text" className="file-editor-text" spellCheck={false} value={draft} disabled={saving || reloading || !!pendingAction} aria-invalid={draftBytes > 1048576} onChange={event => setDraft(event.target.value)} />
            {draftBytes > 1048576 && <StatusMessage tone="error">{t('errors.TEXT_TOO_LARGE')}</StatusMessage>}
          </> : <pre>{info.text}</pre>}
        </>}
        {info.kind !== 'text' && <MediaPreview key={url} kind={info.kind} url={url} name={name} />}
      </>}
  </PreviewDialog>;
}
