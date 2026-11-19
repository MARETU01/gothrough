import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorDescriptor } from '@/services/errors';
import { translateMessage, type Message } from '@/i18n/messages';
import { Button } from './ui/button';
import { StatusMessage } from './StatusMessage';
import './DraftRecovery.css';

export interface DraftComparison { title: string; base: string; draft: string; latest: string | null; changed: boolean }

// Comparing fetches a separate snapshot; the editor's base version stays intact.
export function DraftRecovery({ text, filename, compare, disabled, hint }: {
  text: string; filename: string; compare: (signal: AbortSignal) => Promise<DraftComparison[]>; disabled: boolean; hint?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const alive = useRef(true);
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copy, setCopy] = useState<{ text: string; manual: boolean } | null>(null);
  const [snapshot, setSnapshot] = useState<{ text: string; items: DraftComparison[] } | null>(null);
  const [error, setError] = useState<Message>('');
  const selectManualCopy = useCallback((node: HTMLTextAreaElement | null) => { node?.focus(); node?.select(); }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current?.abort(); };
  }, []);
  async function copyDraft() {
    if (copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (alive.current) setCopy({ text, manual: false });
    } catch { if (alive.current) setCopy({ text, manual: true }); }
    finally { if (alive.current) setCopying(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    // Keep the URL alive until the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function loadComparison() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const items = await compare(controller.signal);
      if (!controller.signal.aborted) setSnapshot({ text, items });
    } catch (reason) { if (!controller.signal.aborted) setError(apiErrorDescriptor(reason)); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  return <section className="draft-recovery" aria-label={t('edit.recovery')}>
    {hint && <p className="draft-recovery-hint">{t(hint)}</p>}
    <div className="draft-recovery-actions">
      <Button variant="outline" disabled={disabled || copying} onClick={() => void copyDraft()}>{t('edit.copyDraft')}</Button>
      <Button variant="outline" disabled={disabled} onClick={download}>{t('edit.exportDraft')}</Button>
      <Button variant="outline" disabled={disabled || loading} onClick={() => void loadComparison()}>{t(loading ? 'preview.loading' : 'edit.compareLatest')}</Button>
    </div>
    {copy?.text === text && (copy.manual ? <>
      <label htmlFor={id}>{t('edit.manualCopy')}</label>
      <textarea id={id} readOnly rows={4} value={text} ref={selectManualCopy} />
    </> : <StatusMessage tone="success">{t('edit.draftCopied')}</StatusMessage>)}
    {error && <StatusMessage tone="error">{translateMessage(error)}</StatusMessage>}
    {snapshot?.text === text && <div className="draft-comparison">
      <p>{t('edit.compareHint')}</p>
      {snapshot.items.map((item, index) => <article key={index}>
        <h3>{item.title}</h3>
        <p>{t(item.changed ? 'edit.latestChanged' : 'edit.latestUnchanged')}</p>
        <div className="draft-comparison-values">
          {[{ label: 'edit.baseContent', value: item.base }, { label: 'edit.draftContent', value: item.draft }, { label: 'edit.latestContent', value: item.latest }].map(({ label, value }) => <div key={label}><h4>{t(label)}</h4><pre>{value === null ? t('edit.missingContent') : value || t('edit.emptyContent')}</pre></div>)}
        </div>
      </article>)}
    </div>}
  </section>;
}
