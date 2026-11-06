import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusMessage } from './StatusMessage';
import { PreviewDialog } from './PreviewDialog';

export function MediaPreview({ kind, url, name }: { kind: 'image' | 'pdf' | 'audio' | 'video'; url: string; name: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  if (error) return <StatusMessage tone="error">{t('preview.failed')}</StatusMessage>;
  const failed = () => setError(true);
  if (kind === 'image') return <>
    {!loaded && <StatusMessage tone="loading">{t('preview.loading')}</StatusMessage>}
    <img src={url} alt={name} onLoad={() => setLoaded(true)} onError={failed} />
  </>;
  if (kind === 'pdf') return <><StatusMessage>{t('preview.pdfHint')}</StatusMessage><iframe src={url} title={name} onError={failed} /></>;
  return kind === 'audio' ? <audio controls preload="metadata" src={url} onError={failed} /> : <video controls playsInline preload="metadata" src={url} onError={failed} />;
}

export function ImagePreview({ name, url, downloadUrl, onClose }: { name: string; url: string; downloadUrl: string; onClose: () => void }) {
  return <PreviewDialog title={name} downloadUrl={downloadUrl} onClose={onClose}><MediaPreview key={url} kind="image" url={url} name={name} /></PreviewDialog>;
}
