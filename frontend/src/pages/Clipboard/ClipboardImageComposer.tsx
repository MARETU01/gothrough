import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { StatusMessage } from '@/components/StatusMessage';
import type { ClipboardImageSettings } from '@/services/clipboard';

export function ClipboardImageComposer({ file, onSelect, busy, settings, error, onRetry, invalid }: {
  file: File | null;
  onSelect: (file: File | null) => void;
  busy: boolean;
  settings: ClipboardImageSettings | null;
  error: string;
  onRetry: () => void;
  invalid: boolean;
}) {
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!file || !preview.current || invalid) return;
    const url = URL.createObjectURL(file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, invalid]);
  return <section className="clipboard-image-composer" aria-label="图片附件">
    <label htmlFor="clipboard-image">选择图片，或在本页按 Ctrl+V / ⌘V 粘贴截图</label>
    <input id="clipboard-image" type="file" accept="image/png,image/jpeg" disabled={busy || !settings?.enabled}
      onChange={event => { onSelect(event.target.files?.[0] ?? null); event.target.value = ''; }} />
    {settings && <p>{settings.enabled
      ? `PNG / JPEG · 每张最多 ${settings.max_size_mb} MiB、${settings.max_pixels.toLocaleString()} 像素 · 图片将保存为 PNG`
      : '图片剪贴板已关闭。'}</p>}
    {error && <StatusMessage tone="error">无法读取图片配置。<Button type="button" variant="outline" onClick={onRetry}>重试</Button></StatusMessage>}
    {file && <div className="clipboard-image-draft">
      {!invalid && <img ref={preview} alt="待发布图片预览" />}
      <p>{file.name || '粘贴的图片'} · {(file.size / 1024).toFixed(1)} KiB</p>
      {invalid && <StatusMessage tone="error">请选择限制大小内的 PNG 或 JPEG 图片。</StatusMessage>}
      <div className="clipboard-entry-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={() => onSelect(null)}>移除图片</Button>
      </div>
    </div>}
  </section>;
}
