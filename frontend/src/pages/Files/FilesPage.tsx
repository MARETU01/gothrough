import { message, translateMessage, type Message } from '@/i18n/messages';
import { useTranslation } from 'react-i18next';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteFile, downloadFileUrl, listFiles, type FileListResponse } from '@/services/files';
import { apiErrorDescriptor } from '@/services/errors';
import { useRemoteData } from '@/hooks/useRemoteData';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { StatusMessage } from '@/components/StatusMessage';
import { FilePreview } from '@/components/FilePreview';
import { Download, Upload } from 'lucide-react';
import { DeleteAction } from '@/components/DeleteButton';
import { RefreshButton } from '@/components/RefreshButton';
import { Timestamp } from '@/components/Timestamp';
import { timestampValue } from '@/utils/dateTime';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { FILES_REFRESH_INTERVAL_MS } from '@/config/files';
import './FilesPage.css';

const PAGE_SIZE = 20;
export default function FilesPage() {
  const { t, i18n } = useTranslation();
  const SORT_OPTIONS = [
    ['mtime_desc', t("最近修改 ↓")], ['mtime_asc', t("最近修改 ↑")],
    ['size_desc', t("文件大小 ↓")], ['size_asc', t("文件大小 ↑")],
    ['name_asc', t("文件名 A→Z")], ['name_desc', t("文件名 Z→A")],
  ] as const;

  usePageTitle(t("已上传文件 - GoThrough"));
  const { data, setData, loading, error, setError, backgroundError, refresh, cancel, cancelBackground, mounted } =
    useRemoteData<FileListResponse | null>(listFiles, null);
  const [notice, setNotice] = useState<Message>('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('mtime_desc');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const deleteInProgress = useRef(false);
  const autoPaused = confirming !== null || deleting !== null || previewing !== null;
  const autoRefresh = useCallback(async () => {
    if (deleteInProgress.current || window.getSelection()?.isCollapsed === false) return;
    await refresh({ background: true });
  }, [refresh]);
  useAutoRefresh(autoRefresh, FILES_REFRESH_INTERVAL_MS, !loading && !autoPaused, cancelBackground);

  function manualRefresh() {
    setConfirming(null);
    void refresh();
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    const files = (data?.files ?? []).filter(file => file.name.toLocaleLowerCase().includes(keyword));
    const [field, direction] = sort.split('_');
    return files.sort((a, b) => {
      const comparison = field === 'size' ? a.size - b.size
        : field === 'name' ? a.name.localeCompare(b.name, i18n.resolvedLanguage, { numeric: true })
        : timestampValue(a.mtime) - timestampValue(b.mtime);
      return (direction === 'asc' ? comparison : -comparison) || a.name.localeCompare(b.name);
    });
  }, [data, query, sort, i18n.resolvedLanguage]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageFiles = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstPage = Math.max(1, Math.min(currentPage - 3, totalPages - 6));
  const pages = Array.from({ length: Math.min(7, totalPages) }, (_, index) => firstPage + index);
  const diskPercent = Math.min(100, Math.max(0, data?.disk_pct ?? 0));

  async function handleDelete(name: string) {
    if (deleteInProgress.current || confirming !== name) return;
    deleteInProgress.current = true;
    setDeleting(name);
    setError('');
    setNotice('');
    cancel();
    try {
      await deleteFile(name);
      if (!mounted.current) return;
      setData(previous => previous ? { ...previous, files: previous.files.filter(file => file.name !== name) } : previous);
      setConfirming(null);
      setNotice(message('files.deleted', { name }));
      await refresh();
    } catch (err) {
      if (mounted.current) setError(message('files.deleteFailed', { name, error: apiErrorDescriptor(err) }));
    } finally {
      deleteInProgress.current = false;
      if (mounted.current) setDeleting(null);
    }
  }

  return (
    <main className="files-page content-page">
      <div className="files-container content-container">
        <header className="files-header">
          <div><h1>{t("已上传文件")}</h1><p>{t("浏览和管理已上传的文件")}</p><p className="files-sync-note">{autoPaused ? t("操作期间暂停自动更新") : t('files.interval', { seconds: FILES_REFRESH_INTERVAL_MS / 1000 })}</p></div>
          <div className="files-actions">
            <RefreshButton loading={loading} disabled={deleting !== null} onClick={manualRefresh} />
            <Button asChild><Link to="/upload"><Upload aria-hidden="true" />{t("上传文件")}</Link></Button>
          </div>
        </header>
        {data && <section className="files-disk" aria-label={t("服务器存储空间")}>
          <dl>
            <div><dt>{t("上传文件总大小")}</dt><dd>{data.total_size_display}</dd></div>
            <div><dt>{t("磁盘可用空间")}</dt><dd>{data.disk_free_display}</dd></div>
            <div><dt>{t("磁盘已用 / 总容量")}</dt><dd>{data.disk_used_display} / {data.disk_total_display}</dd></div>
          </dl>
          <div className="files-disk-meter">
            <div className="files-meter-label"><span>{t("磁盘使用率")}</span><strong>{diskPercent.toFixed(1)}%</strong></div>
            <div className={`files-meter${data.disk_pct_warning ? ' warning' : ''}`} role="progressbar" aria-label={t("磁盘使用率")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={diskPercent}><div style={{ width: `${diskPercent}%` }} /></div>
            {data.disk_pct_warning && <p className="files-warning">{t("磁盘使用率已超过 85%，请及时清理文件。")}</p>}
          </div>
        </section>}
        <div className="files-toolbar">
          <input type="search" aria-label={t("搜索文件名")} placeholder={t("搜索文件名…")} value={query} onChange={event => { setQuery(event.target.value); setPage(1); setConfirming(null); }} />
          <Select aria-label={t("文件排序")} value={sort} onChange={event => { setSort(event.target.value); setPage(1); setConfirming(null); }}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <span className="files-count">{t('files.count', { count: filtered.length })}{query.trim() && data ? t('files.total', { count: data.files.length }) : ''}</span>
        </div>
        {error && <StatusMessage tone="error" action={<RefreshButton loading={loading} disabled={deleting !== null} onClick={manualRefresh} label={t("重新加载")} />}>{translateMessage(error)}</StatusMessage>}
        <div aria-live="polite">{notice && <StatusMessage tone="success">{translateMessage(notice)}</StatusMessage>}{loading && <StatusMessage tone="loading">{t("正在加载文件列表…")}</StatusMessage>}</div>
        {backgroundError && <p className="files-sync-note" role="status">{t("自动更新暂不可用，已保留当前内容，将稍后重试。")}</p>}
        {data && <section aria-label={t("文件列表")} aria-busy={loading}>
          {filtered.length > 0 ? <div className="files-table-scroll"><table>
            <thead><tr><th scope="col">{t("文件名")}</th><th scope="col">{t("大小")}</th><th scope="col">{t("修改时间")}</th><th scope="col">{t("操作")}</th></tr></thead>
            <tbody>{pageFiles.map(file => <tr key={file.name}>
              <td className="files-name">{file.name}</td><td className="files-size">{file.size_display}</td><td className="files-time"><Timestamp value={file.mtime} /></td>
              <td><div className="files-row-actions"><div className="files-action-controls">
                <Button type="button" variant="outline" aria-label={t('preview.open', { name: file.name })} onClick={() => { cancelBackground(); setPreviewing(file.name); }}>{t('preview.button')}</Button>
                <Button asChild variant="outline"><a href={downloadFileUrl(file.name)} download aria-label={t('files.download', { name: file.name })}><Download aria-hidden="true" />{t("下载")}</a></Button>
                <DeleteAction confirming={confirming === file.name} disabled={deleting !== null} busy={deleting === file.name} label={t('files.delete', { name: file.name })} confirmLabel={t('files.confirmDelete', { name: file.name })} onRequest={() => { cancelBackground(); setConfirming(file.name); }} onConfirm={() => void handleDelete(file.name)} onCancel={() => setConfirming(null)} />
              </div><div className="files-actions-sizing" aria-hidden="true">
                <Button asChild variant="outline"><span>{t('preview.button')}</span></Button>
                <Button asChild variant="outline"><span><Download aria-hidden="true" />{t('下载')}</span></Button>
                <Button asChild variant="destructive"><span>{t('确认删除')}</span></Button>
                <Button asChild variant="ghost"><span>{t('取消')}</span></Button>
              </div>
              </div></td>
            </tr>)}</tbody>
          </table></div> : <div className="files-empty">{data.files.length === 0 ? <>{t("还没有上传文件，先去")}<Link to="/upload">{t("上传文件")}</Link>{t("吧。")}</> : <>{t("没有找到匹配的文件。")}<Button type="button" onClick={() => { setQuery(''); setPage(1); }}>{t("清除搜索")}</Button></>}</div>}
          {totalPages > 1 && <nav className="files-pagination" aria-label={t("文件列表分页")}>
            <Button type="button" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setConfirming(null); }}>{t("上一页")}</Button>
            {pages.map(number => <Button type="button" variant={number === currentPage ? "default" : "outline"} key={number} aria-label={t('files.page', { number })} aria-current={number === currentPage ? 'page' : undefined} onClick={() => { setPage(number); setConfirming(null); }}>{number}</Button>)}
            <Button type="button" disabled={currentPage === totalPages} onClick={() => { setPage(currentPage + 1); setConfirming(null); }}>{t("下一页")}</Button>
            <span>{t('files.pages', { current: currentPage, total: totalPages })}</span>
          </nav>}
        </section>}
      </div>
      {previewing !== null && <FilePreview key={previewing} name={previewing} onClose={() => setPreviewing(null)} onSaved={() => { void refresh(); }} />}
    </main>
  );
}
