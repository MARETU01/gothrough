import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteFile, downloadFileUrl, listFiles, type FileListResponse } from '@/services/files';
import { getErrorBody } from '@/services/upload';
import { errorMessage } from '@/utils/misc';
import { Button } from '@/components/ui/button';
import { StatusMessage } from '@/components/StatusMessage';
import { ConfirmDeleteDialog } from '@/components/ConfirmDeleteDialog';
import { Download, RefreshCw, Upload, Trash2 } from 'lucide-react';
import './FilesPage.css';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  ['mtime_desc', '最近修改 ↓'], ['mtime_asc', '最近修改 ↑'],
  ['size_desc', '文件大小 ↓'], ['size_asc', '文件大小 ↑'],
  ['name_asc', '文件名 A→Z'], ['name_desc', '文件名 Z→A'],
] as const;

export default function FilesPage() {
  const [data, setData] = useState<FileListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('mtime_desc');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await listFiles(controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(getErrorBody<{ error?: string }>(err)?.error ?? errorMessage(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const previousTitle = document.title;
    document.title = '已上传文件 - GoThrough';
    // Fetch the remote list on mount; refresh also manages loading/error state.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
      document.title = previousTitle;
    };
  }, [refresh]);


  const filtered = React.useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    const files = (data?.files ?? []).filter(file => file.name.toLocaleLowerCase().includes(keyword));
    const [field, direction] = sort.split('_');
    return files.sort((a, b) => {
      const comparison = field === 'size' ? a.size - b.size
        : field === 'name' ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
        : a.mtime.localeCompare(b.mtime);
      return (direction === 'asc' ? comparison : -comparison) || a.name.localeCompare(b.name);
    });
  }, [data, query, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageFiles = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstPage = Math.max(1, Math.min(currentPage - 3, totalPages - 6));
  const pages = Array.from({ length: Math.min(7, totalPages) }, (_, index) => firstPage + index);
  const diskPercent = Math.min(100, Math.max(0, data?.disk_pct ?? 0));

  async function handleDelete(name: string) {
    if (deleting !== null) return;

    setDeleting(name);
    setError('');
    setNotice('');
    requestRef.current?.abort();
    setLoading(false);
    try {
      await deleteFile(name);
      if (!mounted.current) return;
      setData(previous => previous ? { ...previous, files: previous.files.filter(file => file.name !== name) } : previous);
      setConfirming(null);
      setNotice(`已删除 ${name}`);
      await refresh();
    } catch (err) {
      if (mounted.current) { setConfirming(null); setError(`删除 ${name} 失败：${getErrorBody<{ error?: string }>(err)?.error ?? errorMessage(err)}`); }
    } finally {
      if (mounted.current) setDeleting(null);
    }
  }

  return (
    <main className="files-page">
      <div className="files-container">
        <header className="files-header">
          <div><h1>已上传文件</h1><p>浏览和管理已上传的文件</p></div>
          <div className="files-actions">
            <Button type="button" variant="outline" disabled={loading || deleting !== null} onClick={() => void refresh()}><RefreshCw aria-hidden="true" className={loading ? 'app-spin' : undefined} />刷新列表</Button>
            <Button asChild><Link to="/upload"><Upload aria-hidden="true" />上传文件</Link></Button>
          </div>
        </header>
        {data && <section className="files-disk" aria-label="服务器存储空间">
          <dl>
            <div><dt>上传文件总大小</dt><dd>{data.total_size_display}</dd></div>
            <div><dt>磁盘可用空间</dt><dd>{data.disk_free_display}</dd></div>
            <div><dt>磁盘已用 / 总容量</dt><dd>{data.disk_used_display} / {data.disk_total_display}</dd></div>
          </dl>
          <div className="files-disk-meter">
            <div className="files-meter-label"><span>磁盘使用率</span><strong>{diskPercent.toFixed(1)}%</strong></div>
            <div className={`files-meter${data.disk_pct_warning ? ' warning' : ''}`} role="progressbar" aria-label="磁盘使用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={diskPercent}><div style={{ width: `${diskPercent}%` }} /></div>
            {data.disk_pct_warning && <p className="files-warning">磁盘使用率已超过 85%，请及时清理文件。</p>}
          </div>
        </section>}
        <div className="files-toolbar">
          <input type="search" aria-label="搜索文件名" placeholder="搜索文件名…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); setConfirming(null); }} />
          <select aria-label="文件排序" value={sort} onChange={event => { setSort(event.target.value); setPage(1); setConfirming(null); }}>
            {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="files-count">{filtered.length} 个文件{query.trim() && data ? ` / 共 ${data.files.length} 个` : ''}</span>
        </div>
        {error && <StatusMessage tone="error" action={<Button type="button" variant="outline" disabled={loading || deleting !== null} onClick={() => void refresh()}>重新加载</Button>}>{error}</StatusMessage>}
        <div aria-live="polite">{notice && <StatusMessage tone="success">{notice}</StatusMessage>}{loading && <StatusMessage tone="loading">正在加载文件列表…</StatusMessage>}</div>
        {data && <section aria-label="文件列表" aria-busy={loading}>
          {filtered.length > 0 ? <div className="files-table-scroll"><table>
            <thead><tr><th scope="col">文件名</th><th scope="col">大小</th><th scope="col">修改时间</th><th scope="col">操作</th></tr></thead>
            <tbody>{pageFiles.map(file => <tr key={file.name}>
              <td className="files-name">{file.name}</td><td className="files-size">{file.size_display}</td><td className="files-time">{file.mtime}</td>
              <td><div className="files-row-actions">
                <Button asChild variant="outline" size="sm"><a href={downloadFileUrl(file.name)} download aria-label={`下载 ${file.name}`}><Download aria-hidden="true" />下载</a></Button>
                <Button type="button" variant="destructive" size="sm" disabled={deleting !== null} aria-label={`删除 ${file.name}`} onClick={() => setConfirming(file.name)}>
                  <Trash2 aria-hidden="true" />删除
                </Button>
              </div></td>
            </tr>)}</tbody>
          </table></div> : <div className="files-empty">{data.files.length === 0 ? <>还没有上传文件，先去<Link to="/upload">上传文件</Link>吧。</> : <>没有找到匹配的文件。<Button type="button" onClick={() => { setQuery(''); setPage(1); }}>清除搜索</Button></>}</div>}
          {totalPages > 1 && <nav className="files-pagination" aria-label="文件列表分页">
            <Button type="button" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setConfirming(null); }}>上一页</Button>
            {pages.map(number => <Button type="button" variant={number === currentPage ? "default" : "outline"} key={number} aria-label={`第 ${number} 页`} aria-current={number === currentPage ? 'page' : undefined} onClick={() => { setPage(number); setConfirming(null); }}>{number}</Button>)}
            <Button type="button" disabled={currentPage === totalPages} onClick={() => { setPage(currentPage + 1); setConfirming(null); }}>下一页</Button>
            <span>第 {currentPage} / {totalPages} 页</span>
          </nav>}
        </section>}
      </div>
      <ConfirmDeleteDialog filename={confirming} busy={deleting !== null} onCancel={() => setConfirming(null)} onConfirm={() => { if (confirming !== null) void handleDelete(confirming); }} />
    </main>
  );
}
