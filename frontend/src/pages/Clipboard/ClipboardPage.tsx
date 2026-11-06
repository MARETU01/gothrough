import { useCallback, useRef, useState } from 'react';
import { Clipboard, Copy, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusMessage } from '@/components/StatusMessage';
import {
  CLIPBOARD_MAX_BYTES, CLIPBOARD_MAX_ENTRIES,
  createClipboard, deleteClipboard, clearClipboard, listClipboard, type ClipboardEntry,
} from '@/services/clipboard';
import { apiErrorMessage } from '@/services/errors';
import { NOT_MODIFIED, useRemoteData, type RemoteLoadContext } from '@/hooks/useRemoteData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { CLIPBOARD_REFRESH_INTERVAL_MS } from '@/config/clipboard';
import './ClipboardPage.css';

export default function ClipboardPage() {
  const [text, setText] = useState('');
  const etag = useRef<string | undefined>(undefined);
  const loadEntries = useCallback(async (signal?: AbortSignal, context?: RemoteLoadContext) => {
    const result = await listClipboard(signal, context?.background ? etag.current : undefined);
    // Cancelled responses must never advance the validator independently of data.
    context?.onAccepted(() => { etag.current = result.etag; });
    return result.notModified ? NOT_MODIFIED : result.entries;
  }, []);
  usePageTitle('共享剪贴板 - GoThrough');
  const { data: entries, setData: setEntries, loading, error, setError, backgroundError, refresh: reload, cancel, cancelBackground, mounted } =
    useRemoteData<ClipboardEntry[]>(loadEntries, []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
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
    successMessage: string,
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
    } catch (err) {
      if (mounted.current) setError(apiErrorMessage(err));
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const publish = () => {
    if (!text.trim() || tooLarge) return;
    return runMutation(() => createClipboard(text), entry => {
      setEntries(previous => [entry, ...previous].slice(0, CLIPBOARD_MAX_ENTRIES));
      setText('');
    }, '文本已发布。');
  };

  const removeEntry = (id: string) =>
    runMutation(() => deleteClipboard(id), () => {
      setEntries(previous => previous.filter(entry => entry.id !== id));
      setConfirming(null);
      setConfirmingAll(false);
      setManualCopy(previous => previous?.id === id ? null : previous);
    }, '记录已删除。');

  const clearAll = () =>
    runMutation(clearClipboard, () => {
      setEntries([]);
      setConfirming(null);
      setConfirmingAll(false);
      setManualCopy(null);
    }, '全部记录已删除。');

  const copy = async (entry: ClipboardEntry) => {
    if (copyInProgress.current) return;
    copyInProgress.current = true;
    cancelBackground();
    setCopying(true);
    setNotice('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(entry.text);
      if (mounted.current) {
        setManualCopy(null);
        setNotice('已复制到剪贴板。');
      }
    } catch {
      if (mounted.current) setManualCopy(entry);
    } finally {
      copyInProgress.current = false;
      if (mounted.current) setCopying(false);
    }
  };

  return (
    <main className="clipboard-page content-page">
      <div className="clipboard-container content-container">
        <header className="clipboard-header">
          <div>
            <h1><Clipboard aria-hidden="true" />共享剪贴板</h1>
            <p>在设备之间分享文本，粘贴、发布，然后在另一台设备上复制。</p>
          </div>
        </header>

        <form className="clipboard-composer" onSubmit={event => { event.preventDefault(); void publish(); }}>
          <label htmlFor="clipboard-text">输入或粘贴文本</label>
          <textarea id="clipboard-text" value={text} disabled={busy} rows={6}
            placeholder="在这里输入或粘贴文本……" aria-describedby="clipboard-limit"
            aria-invalid={tooLarge} onChange={event => setText(event.target.value)} />
          <div className="clipboard-compose-actions">
            <p id="clipboard-limit" className={tooLarge ? 'clipboard-limit-error' : ''}>
              {byteLength.toLocaleString()} / {CLIPBOARD_MAX_BYTES.toLocaleString()} 字节 · 每条最多 64 KiB
            </p>
            <Button type="submit" disabled={busy || !text.trim() || tooLarge}>
              <Send aria-hidden="true" />{busy ? '处理中…' : '发布文本'}
            </Button>
          </div>
        </form>

        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
        {manualCopy && <section className="clipboard-manual" aria-label="手动复制">
          <label htmlFor="clipboard-manual-text">无法自动复制，请复制下方已选中的文本（Ctrl+C / ⌘C，或长按复制）。</label>
          <textarea id="clipboard-manual-text" readOnly rows={4} value={manualCopy.text}
            ref={selectManualCopy} />
          <Button variant="outline" onClick={() => setManualCopy(null)}>关闭</Button>
        </section>}

        <section aria-labelledby="clipboard-history-title" aria-busy={loading}>
          <div className="clipboard-history-header">
            <div>
              <h2 id="clipboard-history-title">最近内容</h2>
              <p>最多保留 100 条，超出后自动淘汰最旧记录。</p>
              <p>{autoPaused ? '操作期间暂停自动更新' : `每 ${CLIPBOARD_REFRESH_INTERVAL_MS / 1000} 秒自动更新`}</p>
            </div>
            <div className="clipboard-entry-actions">
              <Button variant="outline" disabled={loading || busy} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" />{loading ? '加载中…' : '刷新'}
              </Button>
              <Button variant="destructive" disabled={loading || busy || !entries.length}
                onClick={() => { cancelBackground(); setConfirming(null); setConfirmingAll(true); }}>
                <Trash2 aria-hidden="true" />全部删除
              </Button>
            </div>
          </div>
          {backgroundError && <p className="clipboard-sync-note" role="status">自动更新暂不可用，已保留当前内容，将稍后重试。</p>}
          {confirmingAll && <div className="clipboard-clear-confirm" role="group" aria-label="全部删除确认">
            <p>确定删除所有设备共享的全部记录？删除后无法恢复。</p>
            <div className="clipboard-entry-actions">
              <Button variant="destructive" disabled={busy || loading} onClick={() => void clearAll()}>确认全部删除</Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmingAll(false)}>取消</Button>
            </div>
          </div>}
          {!loading && !entries.length && !error && <p className="clipboard-empty">还没有共享内容，发布第一段文本吧。</p>}
          <ul className="clipboard-list">
            {entries.map((entry, index) => <li key={entry.id}>
              <article className="clipboard-entry" aria-label={`记录 ${index + 1}`}>
                <pre>{entry.text}</pre>
                <footer>
                  <time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString()}</time>
                  <div className="clipboard-entry-actions">
                    <Button variant="outline" disabled={copying} onClick={() => void copy(entry)} aria-label={`复制记录 ${index + 1}`}><Copy aria-hidden="true" />复制</Button>
                    {confirming === entry.id ? <>
                      <Button variant="destructive" disabled={busy} onClick={() => void removeEntry(entry.id)} aria-label={`确认删除记录 ${index + 1}`}>确认删除</Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>取消</Button>
                    </> : <Button variant="outline" disabled={busy} onClick={() => { cancelBackground(); setConfirming(entry.id); }} aria-label={`删除记录 ${index + 1}`}><Trash2 aria-hidden="true" />删除</Button>}
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
