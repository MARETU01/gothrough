import { useContext, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole } from 'lucide-react';
import { AccessContext } from '@/contexts/AccessContext';
import { useSharedUploadQueue } from '@/contexts/UploadQueueContext';
import { Button } from './ui/button';
import { ConfirmActions } from './ConfirmActions';

function LogoutConfirmation({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="logout-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>{t('auth.confirmLock')}</h2>
    <p id={descriptionId}>{t('auth.uploadWarning')}</p>
    <div className="app-dialog-actions"><ConfirmActions busy={busy} onConfirm={onConfirm} onCancel={onClose}
      confirmLabel={t('auth.lockAnyway')} cancelLabel={t('auth.keepUploading')} focusCancel /></div>
  </dialog>;
}

export function LogoutButton() {
  const { t } = useTranslation();
  const access = useContext(AccessContext);
  const { items, running, readingFolders } = useSharedUploadQueue();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  async function logout() {
    if (inProgress.current) return;
    inProgress.current = true;
    setBusy(true);
    try { await access.logout(); }
    finally { inProgress.current = false; setBusy(false); setConfirming(false); }
  }
  if (!access.enabled) return null;
  return <>
    <Button variant="outline" type="button" disabled={busy} onClick={() => {
      if (running || readingFolders || items.some(item => item.state !== 'success')) setConfirming(true);
      else void logout();
    }}><LockKeyhole aria-hidden="true" />{t('auth.lock')}</Button>
    {confirming && <LogoutConfirmation busy={busy} onConfirm={() => void logout()} onClose={() => setConfirming(false)} />}
  </>;
}
