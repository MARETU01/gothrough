import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { StatusMessage } from '@/components/StatusMessage';
import type { ClipboardImageSettings } from '@/services/clipboard';
import type { Message } from '@/i18n/messages';

export function ClipboardImageComposer({ file, onSelect, busy, settings, error, onRetry, invalid }: {
  file: File | null;
  onSelect: (file: File | null) => void;
  busy: boolean;
  settings: ClipboardImageSettings | null;
  error: Message;
  onRetry: () => void;
  invalid: boolean;
}) {
  const { t, i18n } = useTranslation();
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file || !preview.current || invalid) return;
    const url = URL.createObjectURL(file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, invalid]);
  return <section className="clipboard-image-composer" aria-label={t("图片附件")}>
    <label htmlFor="clipboard-image">{t("选择图片，或在本页按 Ctrl+V / ⌘V 粘贴截图")}</label>
    <input id="clipboard-image" type="file" accept="image/png,image/jpeg" disabled={busy || !settings?.enabled}
      onChange={event => { onSelect(event.target.files?.[0] ?? null); event.target.value = ''; }} />
    {settings && <p>{settings.enabled
      ? t('clipboard.imageLimits', { size: settings.max_size_mb, pixels: settings.max_pixels.toLocaleString(i18n.resolvedLanguage) })
      : t("图片剪贴板已关闭。")}</p>}
    {error && <StatusMessage tone="error">{t("无法读取图片配置。")}<Button type="button" variant="outline" onClick={onRetry}>{t("重试")}</Button></StatusMessage>}
    {file && <div className="clipboard-image-draft">
      {!invalid && <img ref={preview} alt={t("待发布图片预览")} />}
      <p>{file.name || t("粘贴的图片")} · {(file.size / 1024).toFixed(1)} KiB</p>
      {invalid && <StatusMessage tone="error">{t("请选择限制大小内的 PNG 或 JPEG 图片。")}</StatusMessage>}
      <div className="clipboard-entry-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => onSelect(null)}>{t("移除图片")}</Button>
      </div>
    </div>}
  </section>;
}
