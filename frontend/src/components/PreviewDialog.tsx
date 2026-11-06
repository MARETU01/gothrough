import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import './PreviewDialog.css';

// Common modal lifecycle: native focus trapping, Escape, scroll lock and focus return.
export function PreviewDialog({ title, downloadUrl, busy, onClose, children }: {
  title: string; downloadUrl: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="preview-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="preview-dialog-header">
      <h2 id={titleId}>{title}</h2>
      <div>
        <Button asChild variant="outline"><a href={downloadUrl} download>{t('下载')}</a></Button>
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>{t('关闭')}</Button>
      </div>
    </header>
    <div className="preview-dialog-body">{children}</div>
  </dialog>;
}
