import { message, translateMessage, type Message } from '@/i18n/messages';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deleteSelection, downloadFileUrl, downloadSelectionUrl, getDiskInfo, listFiles, type DiskInfo, type FileListData, type FileBrowserEntry, type DeleteSelectionResult } from '@/services/files';
import { apiErrorDescriptor } from '@/services/errors';
import { NOT_MODIFIED, useRemoteData, type RemoteLoadContext } from '@/hooks/useRemoteData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusMessage } from '@/components/StatusMessage';
import { FilePreview } from '@/components/FilePreview';
import { ArrowUp, ChevronRight, Download, File, Folder, Upload } from 'lucide-react';
import { DeleteAction } from '@/components/DeleteButton';
import { RefreshButton } from '@/components/RefreshButton';
import { Timestamp } from '@/components/Timestamp';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { DISK_REFRESH_INTERVAL_MS, FILES_REFRESH_INTERVAL_MS } from '@/config/files';
import { useEditorDraft } from '@/contexts/EditorDraftContext';
import { FileSelectionBar } from './FileSelectionBar';
import './FilesPage.css';

const PAGE_SIZE = 20;
type BrowserEntry = FileBrowserEntry;

export default function FilesPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('mtime_desc');
  const [page, setPage] = useState(1);
  const requestedDirectory = searchParams.get('dir') ?? '';
  const requestKey = JSON.stringify([requestedDirectory, query.trim(), sort, page]);
  const [acceptedRequestKey, setAcceptedRequestKey] = useState('');
  const SORT_OPTIONS = [
    ['mtime_desc', t("最近修改 ↓")], ['mtime_asc', t("最近修改 ↑")],
    ['size_desc', t("文件大小 ↓")], ['size_asc', t("文件大小 ↑")],
    ['name_asc', t("文件名 A→Z")], ['name_desc', t("文件名 Z→A")],
  ] as const;

  usePageTitle(t("已上传文件 - GoThrough"));
  const etag = useRef<string | undefined>(undefined);
  const acceptedKey = useRef('');
  const loadFiles = useCallback(async (signal?: AbortSignal, context?: RemoteLoadContext) => {
    const result = await listFiles(signal, context?.background && acceptedKey.current === requestKey ? etag.current : undefined,
      { directory: requestedDirectory, search: query.trim(), sort, page, pageSize: PAGE_SIZE });
    context?.onAccepted(() => { etag.current = result.etag; acceptedKey.current = requestKey; setAcceptedRequestKey(requestKey); });
    return result.notModified ? NOT_MODIFIED : result;
  }, [requestedDirectory, query, sort, page, requestKey]);
  const { data, setData, loading, error, setError, backgroundError, refresh, cancel, cancelBackground, mounted } =
    useRemoteData<FileListData | null>(loadFiles, null);
  const { data: disk, loading: diskLoading, error: diskError, backgroundError: diskBackgroundError, refresh: refreshDisk, cancel: cancelDisk, cancelBackground: cancelDiskBackground } =
    useRemoteData<DiskInfo | null>(getDiskInfo, null);
  const [notice, setNotice] = useState<Message>('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { draft: preservedDraft } = useEditorDraft();
  const [previewing, setPreviewing] = useState<string | null>(() => preservedDraft?.name ?? null);
  const deleteInProgress = useRef(false);
  const selectionScope = JSON.stringify([requestKey, data?.directory, data?.page]);
  const [selection, setSelection] = useState<{ scope: string; entries: BrowserEntry[] }>({ scope: '', entries: [] });
  const selected = selection.scope === selectionScope ? selection.entries : [];
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<{ name: string; error: Message }[]>([]);
  // A changed query (including browser history) starts a fresh selection. The
  // scope check hides it immediately, before this cleanup effect runs.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setSelection({ scope: selectionScope, entries: [] });
    setBulkConfirming(false);
    setBulkFailures([]);
  }, [selectionScope]);
  const autoPaused = confirming !== null || deleting !== null || previewing !== null || selected.length > 0 || bulkDeleting;
  const mutationBusy = deleting !== null || bulkDeleting;
  function clearSelection() {
    if (bulkFailures.length) setError('');
    setSelection({ scope: selectionScope, entries: [] });
    setBulkConfirming(false);
    setBulkFailures([]);
  }
  function toggleSelection(file: BrowserEntry) {
    if (mutationBusy || bulkConfirming) return;
    stopBackground();
    setConfirming(null);
    setSelection({ scope: selectionScope, entries: selected.some(entry => entry.name === file.name)
      ? selected.filter(entry => entry.name !== file.name) : [...selected, file] });
    setBulkFailures([]);
    if (bulkFailures.length) setError('');
  }
  const autoRefresh = useCallback(async () => {
    if (deleteInProgress.current || window.getSelection()?.isCollapsed === false) return;
    await refresh({ background: true });
  }, [refresh]);
  useAutoRefresh(autoRefresh, FILES_REFRESH_INTERVAL_MS, !loading && !autoPaused, cancelBackground);
  const autoRefreshDisk = useCallback(async () => {
    if (deleteInProgress.current || window.getSelection()?.isCollapsed === false) return;
    await refreshDisk({ background: true });
  }, [refreshDisk]);
  useAutoRefresh(autoRefreshDisk, DISK_REFRESH_INTERVAL_MS, !diskLoading && !autoPaused, cancelDiskBackground);

  function stopBackground() { cancelBackground(); cancelDiskBackground(); }
  async function refreshAll() { await Promise.all([refresh(), refreshDisk()]); }

  function manualRefresh() {
    if (deleteInProgress.current) return;
    clearSelection();
    setConfirming(null);
    void refreshAll();
  }

  function refreshAfterEdit() {
    etag.current = undefined;
    void refreshAll();
  }

  const directory = data?.directory ?? requestedDirectory;
  const searching = query.trim().length > 0;
  const breadcrumbs = directory ? directory.split('/') : [];

  function openDirectory(name: string) {
    if (deleteInProgress.current) return;
    clearSelection();
    setQuery('');
    setPage(1);
    setConfirming(null);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (name) next.set('dir', name);
      else next.delete('dir');
      return next;
    });
  }

  const folderCount = data?.folder_count ?? 0;
  const totalEntries = data?.total ?? 0;
  const totalFiles = data?.total_files ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const currentPage = data?.page ?? 1;
  const pageFiles = data?.files ?? [];
  const firstPage = Math.max(1, Math.min(currentPage - 3, totalPages - 6));
  const pages = Array.from({ length: Math.min(7, totalPages) }, (_, index) => firstPage + index);
  const diskPercent = Math.min(100, Math.max(0, disk?.disk_pct ?? 0));

  function deletionFailure(result?: DeleteSelectionResult): Message {
    return result?.code && i18n.exists('errors.' + result.code)
      ? message('errors.' + result.code) : result?.error ?? message('errors.FILE_DELETE_FAILED');
  }

  async function handleDelete(name: string) {
    if (deleteInProgress.current || confirming !== name) return;
    clearSelection();
    deleteInProgress.current = true;
    setDeleting(name);
    setError('');
    setNotice('');
    cancel();
    cancelDisk();
    try {
      const response = await deleteSelection([{ path: name, folder: false }]);
      const result = response.results.find(entry => entry.path === name);
      if (!result?.deleted) {
        if (mounted.current) setError(message('files.deleteFailed', { name, error: deletionFailure(result) }));
        return;
      }
      if (!mounted.current) return;
      etag.current = undefined;
      setData(previous => previous ? { ...previous, files: previous.files.filter(file => file.name !== name) } : previous);
      setConfirming(null);
      setNotice(message('files.deleted', { name }));
      await refreshAll();
    } catch (err) {
      if (mounted.current) setError(message('files.deleteFailed', { name, error: apiErrorDescriptor(err) }));
    } finally {
      deleteInProgress.current = false;
      if (mounted.current) setDeleting(null);
    }
  }

  async function handleBulkDelete() {
    if (deleteInProgress.current || !bulkConfirming || !selected.length) return;
    const entries = [...selected];
    deleteInProgress.current = true;
    setBulkDeleting(true);
    setError(''); setNotice(''); setBulkFailures([]);
    cancel(); cancelDisk();
    try {
      const response = await deleteSelection(entries.map(entry => ({ path: entry.name, folder: entry.folder })));
      if (!mounted.current) return;
      const results = new Map(response.results.map(result => [result.path, result]));
      const failed = entries.filter(entry => !results.get(entry.name)?.deleted);
      const deleted = entries.filter(entry => results.get(entry.name)?.deleted);
      setSelection({ scope: selectionScope, entries: failed });
      setBulkConfirming(false);
      setBulkFailures(failed.map(entry => {
        const result = results.get(entry.name);
        return { name: entry.name, error: deletionFailure(result) };
      }));
      setData(previous => previous ? { ...previous, files: previous.files.filter(file => !deleted.some(entry =>
        file.name === entry.name || (entry.folder && file.name.startsWith(entry.name + '/')))) } : previous);
      etag.current = undefined;
      if (deleted.length) setNotice(message('batch.deleted', { count: deleted.length }));
      if (failed.length) setError(message('batch.failed', { count: failed.length }));
      // Background refresh preserves the partial-failure notice and retry selection.
      await Promise.all([refresh({ background: true }), refreshDisk({ background: true })]);
    } catch (err) {
      if (mounted.current) { setError(apiErrorDescriptor(err)); setBulkConfirming(false); }
    } finally {
      deleteInProgress.current = false;
      if (mounted.current) setBulkDeleting(false);
    }
  }

  return (
    <main className="files-page content-page">
      <div className="files-container content-container">
        <header className="files-header">
          <div><h1>{t("已上传文件")}</h1><p>{t("浏览和管理已上传的文件")}</p><p className="files-sync-note">{autoPaused ? t("操作期间暂停自动更新") : t('files.interval', { seconds: FILES_REFRESH_INTERVAL_MS / 1000 })}</p></div>
          <div className="files-actions">
            <RefreshButton loading={loading || diskLoading} disabled={mutationBusy} onClick={manualRefresh} />
            <Button asChild><Link to="/upload"><Upload aria-hidden="true" />{t("上传文件")}</Link></Button>
          </div>
        </header>
        {diskError && <StatusMessage tone="error" action={<RefreshButton loading={diskLoading} disabled={mutationBusy} onClick={() => void refreshDisk()} label={t("重新加载")} />}>{translateMessage(diskError)}</StatusMessage>}
        {disk && <section className="files-disk" aria-label={t("服务器存储空间")}>
          <dl>
            <div><dt>{t("上传文件总大小")}</dt><dd>{data?.total_size_display ?? '—'}</dd></div>
            <div><dt>{t("磁盘可用空间")}</dt><dd>{disk.disk_free_display}</dd></div>
            <div><dt>{t("磁盘已用 / 总容量")}</dt><dd>{disk.disk_used_display} / {disk.disk_total_display}</dd></div>
          </dl>
          <div className="files-disk-meter">
            <div className="files-meter-label"><span>{t("磁盘使用率")}</span><strong>{diskPercent.toFixed(1)}%</strong></div>
            <div className={`files-meter${disk.disk_pct_warning ? ' warning' : ''}`} role="progressbar" aria-label={t("磁盘使用率")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={diskPercent}><div style={{ width: `${diskPercent}%` }} /></div>
            {disk.disk_pct_warning && <p className="files-warning">{t("磁盘使用率已超过 85%，请及时清理文件。")}</p>}
          </div>
        </section>}
        <div className="files-location">
          <nav className="files-breadcrumbs" aria-label={t('browser.path')}>
            <button type="button" disabled={mutationBusy} aria-current={!directory ? 'page' : undefined} onClick={() => openDirectory('')}>{t('browser.root')}</button>
            {breadcrumbs.map((part, index) => <span key={index}>
              <ChevronRight aria-hidden="true" />
              <button type="button" disabled={mutationBusy} aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined} onClick={() => openDirectory(breadcrumbs.slice(0, index + 1).join('/'))}>{part}</button>
            </span>)}
          </nav>
          {directory && <Button type="button" variant="outline" disabled={mutationBusy} onClick={() => openDirectory(breadcrumbs.slice(0, -1).join('/'))}><ArrowUp aria-hidden="true" />{t('browser.up')}</Button>}
        </div>
        <div className="files-toolbar">
          <input type="search" disabled={mutationBusy} aria-label={t("搜索文件名")} placeholder={t("搜索文件名…")} value={query} onChange={event => { clearSelection(); setQuery(event.target.value); setPage(1); setConfirming(null); }} />
          <Select disabled={mutationBusy} aria-label={t("文件排序")} value={sort} onChange={event => { clearSelection(); setSort(event.target.value); setPage(1); setConfirming(null); }}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <span className="files-count">{folderCount > 0 ? t('browser.count', { folders: folderCount, files: totalEntries - folderCount }) : t('files.count', { count: totalEntries })}{searching && data ? t('files.total', { count: totalFiles }) : ''}</span>
        </div>
        {searching && <p className="files-sync-note">{t('browser.searchHint')}</p>}
        {error && <StatusMessage tone="error" action={<RefreshButton loading={loading} disabled={mutationBusy} onClick={manualRefresh} label={t("重新加载")} />}>{translateMessage(error)}</StatusMessage>}
        <div aria-live="polite">{notice && <StatusMessage tone="success">{translateMessage(notice)}</StatusMessage>}{loading && <StatusMessage tone="loading">{t("正在加载文件列表…")}</StatusMessage>}</div>
        {(backgroundError || diskBackgroundError) && <p className="files-sync-note" role="status">{t("自动更新暂不可用，已保留当前内容，将稍后重试。")}</p>}
        {data && acceptedRequestKey === requestKey && <section aria-label={t("文件列表")} aria-busy={loading}>
          <FileSelectionBar names={selected.map(entry => entry.name)} pageNames={pageFiles.map(entry => entry.name)} disabled={loading || mutationBusy} confirming={bulkConfirming} busy={bulkDeleting}
            onSelectAll={() => { stopBackground(); setConfirming(null); setBulkFailures([]); if (bulkFailures.length) setError(''); setSelection({ scope: selectionScope, entries: [...pageFiles] }); }}
            onClear={clearSelection} onRequest={() => { stopBackground(); setConfirming(null); setBulkConfirming(true); }}
            onCancel={() => setBulkConfirming(false)} onConfirm={() => void handleBulkDelete()} />
          {bulkFailures.length > 0 && <ul className="files-selection-failures">{bulkFailures.map(failure => <li key={failure.name}>{failure.name}: {translateMessage(failure.error)}</li>)}</ul>}
          {pageFiles.length > 0 ? <div className="files-table-scroll"><table role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col" className="files-select">{t("batch.selection")}</th><th role="columnheader" scope="col">{t("文件名")}</th><th role="columnheader" scope="col">{t("大小")}</th><th role="columnheader" scope="col">{t("修改时间")}</th><th role="columnheader" scope="col">{t("操作")}</th></tr></thead>
            <tbody role="rowgroup">{pageFiles.map(file => <tr role="row" key={file.name}>
              <td role="cell" className="files-select"><label><input type="checkbox" aria-label={t('batch.select', { name: file.name })}
                checked={selected.some(entry => entry.name === file.name)} disabled={mutationBusy || bulkConfirming || loading} onChange={() => toggleSelection(file)} /></label></td>
              <td role="cell" className="files-name">{file.folder ? <button type="button" className="files-folder-link" disabled={mutationBusy} aria-label={t('browser.open', { name: file.name })} onClick={() => openDirectory(file.name)}><Folder aria-hidden="true" /><span>{file.label}</span></button> : <span className="files-file-label"><File aria-hidden="true" /><span>{file.label}</span></span>}</td><td role="cell" className="files-size" data-label={t('大小')}>{file.size_display}</td><td role="cell" className="files-time" data-label={t('修改时间')}>{file.folder ? '—' : <Timestamp value={file.mtime} />}</td>
              <td role="cell">{file.folder ? <div className="files-action-controls"><Button asChild variant="outline"><a href={downloadSelectionUrl([file.name])} download aria-label={t('folders.download', { name: file.name })}><Download aria-hidden="true" />{t('folders.zip')}</a></Button></div> : <div className="files-row-actions"><div className="files-action-controls">
                <Button type="button" variant="outline" aria-label={t('preview.open', { name: file.name })} disabled={mutationBusy} onClick={() => { stopBackground(); setBulkConfirming(false); setPreviewing(file.name); }}>{t('preview.button')}</Button>
                <Button asChild variant="outline"><a href={downloadFileUrl(file.name)} download aria-label={t('files.download', { name: file.name })}><Download aria-hidden="true" />{t("下载")}</a></Button>
                <DeleteAction confirming={confirming === file.name} disabled={mutationBusy} busy={deleting === file.name} label={t('files.delete', { name: file.name })} confirmLabel={t('files.confirmDelete', { name: file.name })} onRequest={() => { stopBackground(); clearSelection(); setConfirming(file.name); }} onConfirm={() => void handleDelete(file.name)} onCancel={() => setConfirming(null)} />
              </div><div className="files-actions-sizing" aria-hidden="true">
                <Button asChild variant="outline"><span>{t('preview.button')}</span></Button>
                <Button asChild variant="outline"><span><Download aria-hidden="true" />{t('下载')}</span></Button>
                <Button asChild variant="destructive"><span>{t('确认删除')}</span></Button>
                <Button asChild variant="ghost"><span>{t('取消')}</span></Button>
              </div>
              </div>}</td>
            </tr>)}</tbody>
          </table></div> : <div className="files-empty">{totalFiles === 0 ? <>{t("还没有上传文件，先去")}<Link to="/upload">{t("上传文件")}</Link>{t("吧。")}</> : <>{t("没有找到匹配的文件。")}<Button type="button" onClick={() => { setQuery(''); setPage(1); }}>{t("清除搜索")}</Button></>}</div>}
          {totalPages > 1 && <nav className="files-pagination" aria-label={t("文件列表分页")}>
            <Button type="button" disabled={mutationBusy || currentPage === 1} onClick={() => { clearSelection(); setPage(currentPage - 1); setConfirming(null); }}>{t("上一页")}</Button>
            {pages.map(number => <Button type="button" disabled={mutationBusy} variant={number === currentPage ? "default" : "outline"} key={number} aria-label={t('files.page', { number })} aria-current={number === currentPage ? 'page' : undefined} onClick={() => { clearSelection(); setPage(number); setConfirming(null); }}>{number}</Button>)}
            <Button type="button" disabled={mutationBusy || currentPage === totalPages} onClick={() => { clearSelection(); setPage(currentPage + 1); setConfirming(null); }}>{t("下一页")}</Button>
            <span>{t('files.pages', { current: currentPage, total: totalPages })}</span>
          </nav>}
        </section>}
      </div>
      {previewing !== null && <FilePreview key={previewing} name={previewing} onClose={() => setPreviewing(null)} onSaved={refreshAfterEdit} />}
    </main>
  );
}
