import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFileUrl, getFilePreview, previewFileUrl, saveFileText, type FilePreviewInfo } from '@/services/files';
import { apiErrorDescriptor, getErrorBody } from '@/services/errors';
import { translateMessage, type Message } from '@/i18n/messages';
import { Button } from './ui/button';
import './FilePreview.css';

export function FilePreview({ name, onClose, onSaved }: { name: string; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<FilePreviewInfo | null>(null);
  const [error, setError] = useState<Message>('');
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editError, setEditError] = useState<Message>('');
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const reloadRequest = useRef<AbortController | null>(null);
  const dirty = editing && draft !== info?.text;
  const draftBytes = new TextEncoder().encode(draft).length;

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

  function canDiscard() { return !dirty || window.confirm(t('edit.discard')); }
  function close() { if (!busy.current && !reloading && canDiscard()) onClose(); }

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
    if (busy.current || reloading || !canDiscard()) return;
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
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);

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
  const failed = () => setError({ key: 'preview.failed' });
  return <dialog ref={dialog} className="file-preview" aria-labelledby="file-preview-title" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="file-preview-header">
      <h2 id="file-preview-title">{name}</h2>
      <div>
        <Button asChild variant="outline"><a href={downloadFileUrl(name)} download>{t('下载')}</a></Button>
        <Button variant="outline" autoFocus disabled={saving || reloading} onClick={close}>{t('关闭')}</Button>
      </div>
    </header>
    <div className="file-preview-body">
      {error ? <p role="alert">{translateMessage(error)}</p> : !info ? <p role="status">{t('preview.loading')}</p> : <>
        {info.kind === 'text' && <>
          <div className="file-editor-toolbar">
            {editing ? <>
              <Button disabled={saving || reloading || !dirty || conflict || draftBytes > 1048576} onClick={() => void save()}>{t(saving ? 'edit.saving' : 'edit.save')}</Button>
              <Button variant="outline" disabled={saving || reloading} onClick={() => { if (canDiscard()) { setEditing(false); setEditError(''); } }}>{t('edit.cancel')}</Button>
              <span>{t('edit.bytes', { count: draftBytes })}</span>
            </> : <Button variant="outline" disabled={!info.version || reloading} onClick={() => { setDraft(info.text); setEditing(true); setEditError(''); setSaved(false); }}>{t('edit.button')}</Button>}
            {conflict && <Button variant="outline" disabled={saving || reloading} onClick={() => void reload()}>{t(reloading ? 'preview.loading' : 'edit.reload')}</Button>}
          </div>
          {editError && <p role="alert">{translateMessage(editError)}</p>}
          {saved && <p role="status">{t('edit.saved')}</p>}
          {editing ? <>
            <label className="sr-only" htmlFor="file-editor-text">{t('edit.content')}</label>
            <textarea id="file-editor-text" className="file-editor-text" autoFocus spellCheck={false} value={draft} disabled={saving || reloading} aria-invalid={draftBytes > 1048576} onChange={event => setDraft(event.target.value)} />
            {draftBytes > 1048576 && <p role="alert">{t('errors.TEXT_TOO_LARGE')}</p>}
          </> : <pre>{info.text}</pre>}
        </>}
        {info.kind === 'image' && <>{!loaded && <p role="status">{t('preview.loading')}</p>}<img src={url} alt={name} onLoad={() => setLoaded(true)} onError={failed} /></>}
        {info.kind === 'pdf' && <><p>{t('preview.pdfHint')}</p><iframe src={url} title={name} onError={failed} /></>}
        {info.kind === 'audio' && <audio controls preload="metadata" src={url} onError={failed} />}
        {info.kind === 'video' && <video controls playsInline preload="metadata" src={url} onError={failed} />}
      </>}
    </div>
  </dialog>;
}
