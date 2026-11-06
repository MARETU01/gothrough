import { message, translateMessage, type Message } from '@/i18n/messages';
import { useTranslation } from 'react-i18next';
import { useCallback, useRef, useState } from 'react';
import { Clipboard, Copy, Download, ExternalLink, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusMessage } from '@/components/StatusMessage';
import {
  CLIPBOARD_MAX_BYTES, CLIPBOARD_MAX_ENTRIES,
  createClipboard, createClipboardImage, fetchClipboardImage, getClipboardImageSettings, deleteClipboard, clearClipboard, listClipboard, type ClipboardEntry, type ClipboardImageSettings,
} from '@/services/clipboard';
import { apiErrorDescriptor } from '@/services/errors';
import { NOT_MODIFIED, useRemoteData, type RemoteLoadContext } from '@/hooks/useRemoteData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { CLIPBOARD_REFRESH_INTERVAL_MS } from '@/config/clipboard';
import './ClipboardPage.css';
import { ClipboardImageComposer } from './ClipboardImageComposer';

export default function ClipboardPage() {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const { data: imageSettings, error: imageSettingsError, refresh: reloadImageSettings } =
    useRemoteData<ClipboardImageSettings | null>(getClipboardImageSettings, null);
  const imageInvalid = !!imageFile && (!['image/png', 'image/jpeg'].includes(imageFile.type) || !!imageSettings && imageFile.size > imageSettings.max_size_mb * 1024 * 1024);
  const etag = useRef<string | undefined>(undefined);
  const loadEntries = useCallback(async (signal?: AbortSignal, context?: RemoteLoadContext) => {
    const result = await listClipboard(signal, context?.background ? etag.current : undefined);
    // Cancelled responses must never advance the validator independently of data.
    context?.onAccepted(() => { etag.current = result.etag; });
    return result.notModified ? NOT_MODIFIED : result.entries;
  }, []);
  usePageTitle(t("共享剪贴板 - GoThrough"));
  const { data: entries, setData: setEntries, loading, error, setError, backgroundError, refresh: reload, cancel, cancelBackground, mounted } =
    useRemoteData<ClipboardEntry[]>(loadEntries, []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Message>('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [manualCopy, setManualCopy] = useState<ClipboardEntry | null>(null);
  const [copying, setCopying] = useState(false);
  const copyInProgress = useRef(false);
  const operation = useRef(false);
  const byteLength = new Blob([text]).size;
  const tooLarge = byteLength > CLIPBOARD_MAX_BYTES;
  const autoPaused = busy || confirming !== null || confirmingAll || copying || manualCopy !== null;
  const autoRefresh = useCallback(async () => {
    if (operation.current || copyInProgress.current || window.getSelection()?.isCollapsed === false) return;
    await reload({ background: true });
  }, [reload]);
  useAutoRefresh(autoRefresh, CLIPBOARD_REFRESH_INTERVAL_MS, !loading && !autoPaused, cancelBackground);
  const selectManualCopy = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) { node.focus(); node.select(); }
  }, []);

  const refresh = () => {
    setConfirmingAll(false);
    return reload();
  };

  const runMutation = async <T,>(
    action: () => Promise<T>,
    onSuccess: (result: T) => void,
    successMessage: Message,
  ) => {
    if (operation.current) return;
    operation.current = true;
    cancel();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (!mounted.current) return;
      etag.current = undefined;
      onSuccess(result);
      setNotice(successMessage);
      await refresh();
      return true;
    } catch (err) {
      if (mounted.current) setError(apiErrorDescriptor(err));
      return false;
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const publish = () => {
    if (imageFile) {
      if (!imageSettings?.enabled || imageInvalid) return;
      return runMutation(() => createClipboardImage(imageFile), entry => {
        setEntries(previous => [entry, ...previous].slice(0, CLIPBOARD_MAX_ENTRIES));
        setImageFile(null);
      }, message("图片已发布。"));
    }
    if (!text.trim() || tooLarge) return;
    return runMutation(() => createClipboard(text), entry => {
      setEntries(previous => [entry, ...previous].slice(0, CLIPBOARD_MAX_ENTRIES));
      setText('');
    }, message("文本已发布。"));
  };

  const removeEntry = (id: string) =>
    runMutation(() => deleteClipboard(id), () => {
      setEntries(previous => previous.filter(entry => entry.id !== id));
      setConfirming(null);
      setConfirmingAll(false);
      setManualCopy(previous => previous?.id === id ? null : previous);
    }, message("记录已删除。"));

  const clearAll = () =>
    runMutation(clearClipboard, () => {
      setEntries([]);
      setConfirming(null);
      setConfirmingAll(false);
      setManualCopy(null);
    }, message("全部记录已删除。"));

  const copy = async (entry: ClipboardEntry) => {
    if (copyInProgress.current) return;
    copyInProgress.current = true;
    cancelBackground();
    setCopying(true);
    setNotice('');
    try {
      if (entry.type === 'image') {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Clipboard unavailable');
        // Start write during the click gesture; Safari accepts the promised Blob.
        const image = fetchClipboardImage(entry.id);
        // A denied write may reject before the network request finishes.
        void image.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      } else {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(entry.text);
      }
      if (mounted.current) {
        setManualCopy(null);
        setNotice(message("已复制到剪贴板。"));
      }
    } catch {
      if (mounted.current) setManualCopy(entry);
    } finally {
      copyInProgress.current = false;
      if (mounted.current) setCopying(false);
    }
  };

  return (
    <main className="clipboard-page content-page" onPaste={event => {
      if (busy) return;
      const file = Array.from(event.clipboardData.items).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
      if (file) { event.preventDefault(); setImageFile(file); }
    }}>
      <div className="clipboard-container content-container">
        <header className="clipboard-header">
          <div>
            <h1><Clipboard aria-hidden="true" />{t("共享剪贴板")}</h1>
            <p>{t("在设备之间分享文本和图片，粘贴、发布，然后在另一台设备上复制。")}</p>
          </div>
        </header>

        <form className="clipboard-composer" onSubmit={event => { event.preventDefault(); void publish(); }}>
          <div className="clipboard-compose-header">
            <label htmlFor="clipboard-text">{t("输入或粘贴文本")}</label>
            <Button type="submit" disabled={busy || (imageFile ? !imageSettings?.enabled || imageInvalid : !text.trim() || tooLarge)}>
              <Send aria-hidden="true" />{busy ? t("处理中…") : t("发布")}
            </Button>
          </div>
          <textarea id="clipboard-text" value={text} disabled={busy} rows={6}
            placeholder={t("在这里输入或粘贴文本……")} aria-describedby="clipboard-limit"
            aria-invalid={tooLarge} onChange={event => setText(event.target.value)} />
          <ClipboardImageComposer file={imageFile} onSelect={setImageFile} busy={busy}
            settings={imageSettings} error={imageSettingsError} invalid={imageInvalid} onRetry={() => void reloadImageSettings()} />
          <div className="clipboard-compose-actions">
            <p id="clipboard-limit" className={!imageFile && tooLarge ? 'clipboard-limit-error' : ''}>
              {imageFile ? t("本次发布图片，文本草稿将保留。移除图片后可发布文本。")
                : t('clipboard.bytes', { used: byteLength.toLocaleString(i18n.resolvedLanguage), max: CLIPBOARD_MAX_BYTES.toLocaleString(i18n.resolvedLanguage) })}
            </p>
          </div>
        </form>

        {error && <StatusMessage tone="error">{translateMessage(error)}</StatusMessage>}
        {notice && <StatusMessage tone="success">{translateMessage(notice)}</StatusMessage>}
        {manualCopy && <section className="clipboard-manual" aria-label={t("手动复制")}>
          {manualCopy.type === 'image' ? <>
            <p>{t("无法直接复制图片，请使用 HTTPS 或 localhost 并允许剪贴板权限；也可以打开或下载图片后手动复制。")}</p>
            <div className="clipboard-entry-actions">
              <Button asChild variant="outline"><a href={manualCopy.image?.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t("打开图片")}</a></Button>
              <Button asChild variant="outline"><a href={`${manualCopy.image?.url}?download=1`} download><Download aria-hidden="true" />{t("下载图片")}</a></Button>
            </div>
          </> : <>
          <label htmlFor="clipboard-manual-text">{t("无法自动复制，请复制下方已选中的文本（Ctrl+C / ⌘C，或长按复制）。")}</label>
          <textarea id="clipboard-manual-text" readOnly rows={4} value={manualCopy.text}
            ref={selectManualCopy} />
          </>}
          <Button variant="outline" onClick={() => setManualCopy(null)}>{t("关闭")}</Button>
        </section>}

        <section aria-labelledby="clipboard-history-title" aria-busy={loading}>
          <div className="clipboard-history-header">
            <div>
              <h2 id="clipboard-history-title">{t("最近内容")}</h2>
              <p>{t("最多保留 100 条，超出后自动淘汰最旧记录。")}</p>
              <p>{autoPaused ? t("操作期间暂停自动更新") : t('clipboard.interval', { seconds: CLIPBOARD_REFRESH_INTERVAL_MS / 1000 })}</p>
            </div>
            <div className="clipboard-entry-actions">
              <Button variant="outline" disabled={loading || busy} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" />{loading ? t("加载中…") : t("刷新")}
              </Button>
              <Button variant="destructive" disabled={loading || busy || !entries.length}
                onClick={() => { cancelBackground(); setConfirming(null); setConfirmingAll(true); }}>
                <Trash2 aria-hidden="true" />{t("全部删除")}</Button>
            </div>
          </div>
          {backgroundError && <p className="clipboard-sync-note" role="status">{t("自动更新暂不可用，已保留当前内容，将稍后重试。")}</p>}
          {confirmingAll && <div className="clipboard-clear-confirm" role="group" aria-label={t("全部删除确认")}>
            <p>{t("确定删除所有设备共享的全部记录？删除后无法恢复。")}</p>
            <div className="clipboard-entry-actions">
              <Button variant="destructive" disabled={busy || loading} onClick={() => void clearAll()}>{t("确认全部删除")}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmingAll(false)}>{t("取消")}</Button>
            </div>
          </div>}
          {!loading && !entries.length && !error && <p className="clipboard-empty">{t("还没有共享内容，发布第一段文本吧。")}</p>}
          <ul className="clipboard-list">
            {entries.map((entry, index) => <li key={entry.id}>
              <article className="clipboard-entry" aria-label={t('clipboard.entry', { number: index + 1 })}>
                {entry.type === 'image' && entry.image ? <a href={entry.image.url} target="_blank" rel="noreferrer">
                  <img className="clipboard-history-image" src={`${entry.image.url}?thumbnail=1`} alt={t('clipboard.image', { number: index + 1 })} loading="lazy" decoding="async"
                    onError={event => {
                      if (event.currentTarget.getAttribute('src') !== entry.image?.url) event.currentTarget.src = entry.image!.url;
                      else event.currentTarget.alt = t("图片加载失败，可打开图片重试");
                    }} />
                </a> : <pre>{entry.text}</pre>}
                <footer>
                  <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString(i18n.resolvedLanguage)}</time>
                  <div className="clipboard-entry-actions">
                    <Button variant="outline" disabled={copying} onClick={() => void copy(entry)} aria-label={t('clipboard.copy', { number: index + 1 })}><Copy aria-hidden="true" />{t("复制")}</Button>
                    {entry.type === 'image' && entry.image && <Button asChild variant="outline"><a href={`${entry.image.url}?download=1`} download><Download aria-hidden="true" />{t("下载图片")}</a></Button>}
                    {confirming === entry.id ? <>
                      <Button variant="destructive" disabled={busy} onClick={() => void removeEntry(entry.id)} aria-label={t('clipboard.confirmDelete', { number: index + 1 })}>{t("确认删除")}</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>{t("取消")}</Button>
                    </> : <Button variant="outline" disabled={busy} onClick={() => { cancelBackground(); setConfirming(entry.id); }} aria-label={t('clipboard.delete', { number: index + 1 })}><Trash2 aria-hidden="true" />{t("删除")}</Button>}
                  </div>
                </footer>
              </article>
            </li>)}
          </ul>
        </section>
      </div>
    </main>
  );
}
