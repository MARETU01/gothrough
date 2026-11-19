import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusMessage } from './StatusMessage';
import { PreviewDialog } from './PreviewDialog';
import { ZoomableImage } from './ZoomableImage';
import { checkMedia, mediaFailure, type MediaFailure } from '@/services/media';
import { Button } from './ui/button';

type MediaProps = { kind: 'image' | 'pdf' | 'audio' | 'video'; url: string; name: string };

export function MediaPreview(props: MediaProps) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  return <div ref={container} tabIndex={-1} aria-label={t('preview.content')}><MediaAttempt key={props.kind + props.url + attempt} {...props} retry={() => {
    container.current?.focus({ preventScroll: true }); setAttempt(value => value + 1);
  }} /></div>;
}

function MediaAttempt({ kind, url, name, retry }: MediaProps & { retry: () => void }) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(kind !== 'pdf');
  const [error, setError] = useState<MediaFailure | null>(null);
  const [checking, setChecking] = useState(false);
  const diagnosed = useRef(false);
  const loaded = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    if (kind === 'pdf') void checkMedia(url, controller.signal, 'application/pdf').then(() => {
      if (!controller.signal.aborted) setReady(true);
    }).catch(reason => { if (!controller.signal.aborted) { diagnosed.current = true; setError(mediaFailure(reason)); } });
    const timer = setTimeout(() => { if (!loaded.current) diagnose('network'); }, 30000);
    return () => { controller.abort(); clearTimeout(timer); };
    // Each attempt is keyed by kind/URL; its handlers own this request lifecycle.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url]);
  function diagnose(fallback: MediaFailure) {
    if (diagnosed.current || request.current?.signal.aborted) return;
    diagnosed.current = true; setChecking(true);
    void checkMedia(url, request.current?.signal).then(() => {
      if (!request.current?.signal.aborted) setError(fallback);
    }).catch(reason => { if (!request.current?.signal.aborted) setError(mediaFailure(reason)); })
      .finally(() => { if (!request.current?.signal.aborted) setChecking(false); });
  }
  if (error) return <StatusMessage tone="error" action={<Button variant="outline" onClick={retry}>{t('preview.retry')}</Button>}>{t('preview.failure.' + error)}</StatusMessage>;
  if (checking) return <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>;
  const failed = () => diagnose('unsupported');
  const finished = () => { loaded.current = true; };
  if (kind === 'image') return <ZoomableImage url={url} name={name} onError={failed} onLoad={finished} />;
  if (kind === 'pdf') return ready ? <><StatusMessage>{t('preview.pdfHint')}</StatusMessage><iframe src={url} title={name} onError={failed} onLoad={event => {
    finished();
    try {
      if (event.currentTarget.contentDocument?.contentType === 'application/json') failed();
    } catch { /* Built-in PDF viewers may have an isolated origin. */ }
  }} /></> : <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>;
  return kind === 'audio' ? <audio controls preload="metadata" src={url} onLoadedMetadata={finished} onError={failed} /> : <video controls playsInline preload="metadata" src={url} onLoadedMetadata={finished} onError={failed} />;
}

export function ImagePreview({ name, url, downloadUrl, onClose }: { name: string; url: string; downloadUrl: string; onClose: () => void }) {
  return <PreviewDialog title={name} downloadUrl={downloadUrl} onClose={onClose}><MediaPreview key={url} kind="image" url={url} name={name} /></PreviewDialog>;
}
