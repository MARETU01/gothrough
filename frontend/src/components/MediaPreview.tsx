import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusMessage } from './StatusMessage';
import { PreviewDialog } from './PreviewDialog';
import { ZoomableImage } from './ZoomableImage';
import { checkMedia } from '@/services/media';

export function MediaPreview({ kind, url, name }: { kind: 'image' | 'pdf' | 'audio' | 'video'; url: string; name: string }) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(kind !== 'pdf');
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    if (kind === 'pdf') void checkMedia(url, controller.signal, 'application/pdf').then(() => {
      if (!controller.signal.aborted) setReady(true);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [kind, url]);
  if (error) return <StatusMessage tone="error">{t('preview.failed')}</StatusMessage>;
  const failed = () => {
    setError(true);
    void checkMedia(url, request.current?.signal).catch(() => {});
  };
  if (kind === 'image') return <ZoomableImage url={url} name={name} onError={failed} />;
  if (kind === 'pdf') return ready ? <><StatusMessage>{t('preview.pdfHint')}</StatusMessage><iframe src={url} title={name} onError={failed} onLoad={event => {
    try {
      if (event.currentTarget.contentDocument?.contentType === 'application/json') failed();
    } catch { /* Built-in PDF viewers may have an isolated origin. */ }
  }} /></> : <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>;
  return kind === 'audio' ? <audio controls preload="metadata" src={url} onError={failed} /> : <video controls playsInline preload="metadata" src={url} onError={failed} />;
}

export function ImagePreview({ name, url, downloadUrl, onClose }: { name: string; url: string; downloadUrl: string; onClose: () => void }) {
  return <PreviewDialog title={name} downloadUrl={downloadUrl} onClose={onClose}><MediaPreview key={url} kind="image" url={url} name={name} /></PreviewDialog>;
}
