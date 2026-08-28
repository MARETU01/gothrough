import React, { useEffect } from 'react';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { STATE_LABELS } from '@/types/upload';
import { formatETA, formatSize, formatSpeed } from '@/utils/format';
import { getFileKey } from '@/utils/upload';
import './UploadPage.css';

const UploadPage: React.FC = () => {
  const {
    items,
    globalPaused,
    dragOver,
    setDragOver,
    status,
    totalSpeed,
    pendingCount,
    errorCount,
    successCount,
    activeCount,
    fileInputRef,
    startAllUploads,
    pauseAll,
    resumeAll,
    cancelAll,
    resetAll,
    removeItem,
    handleSelection,
    openFilePicker,
  } = useUploadQueue();

  useEffect(() => {
    document.title = '文件上传 - 分块上传';
  }, []);

  return (
    <div className="upload-page">
      <div className="container">
        <h1>文件上传</h1>
        <p className="subtitle">支持大文件分块上传，可暂停/恢复，断点续传</p>

        <div className="nav-links">
          <a href="/uploads">📦 查看 / 下载已上传文件</a>
        </div>

        <div
          className={`upload-area${dragOver ? ' dragover' : ''}`}
          onClick={openFilePicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) handleSelection(e.dataTransfer.files);
          }}
        >
          <div className="upload-icon">📁</div>
          <p className="upload-text">拖放文件到此处或点击浏览</p>
          <button
            type="button"
            className="browse-btn"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
          >
            选择文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            name="files"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (!files || !files.length) return;
              handleSelection(files);
              e.target.value = '';
            }}
          />
        </div>

        <div className="file-list">
          {items.length === 0 ? (
            <div className="empty-hint">没有文件，拖放文件到此处或点击"选择文件"按钮</div>
          ) : (
            items.map((item, index) => {
              const session = item.session;
              // 字节级进度：服务端已确认的分块 + 正在传输分块的实时已发送字节
              const progress = item.file.size
                ? Math.min(100, Math.round((item.loadedBytes / item.file.size) * 100))
                : 0;
              const speedText = item.speed ? formatSpeed(item.speed) : '';
              const etaText =
                session && item.speed > 0
                  ? formatETA(Math.max(0, item.file.size - item.loadedBytes), item.speed)
                  : '';

              return (
                <div key={getFileKey(item.file)} className={`file-row ${item.state}`}>
                  <div className="file-meta">
                    <div className="file-label">
                      <div className="file-name">{item.file.name}</div>
                      <div className="file-size">{formatSize(item.file.size)}</div>
                    </div>
                    <button
                      type="button"
                      className="remove-btn"
                      disabled={item.state === 'uploading'}
                      onClick={() => removeItem(index)}
                    >
                      移除
                    </button>
                  </div>
                  <div className="file-status">
                    <span>{STATE_LABELS[item.state] || ''}</span>
                    {speedText && <span className="speed">{speedText}</span>}
                    {etaText && <span className="eta">剩余 {etaText}</span>}
                    {session && (
                      <span className="chunks">
                        分块 {session.receivedChunks}/{session.totalChunks}
                      </span>
                    )}
                  </div>
                  <div className="progress-bar">
                    <div className="progress" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="progress-text">
                    <span>{progress}%</span>
                    <span>{item.savedFilename || ''}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>


        {status && <div className={`status-message ${status.type}`}>{status.text}</div>}
        <div className="button-container">
          {items.length > 0 &&
            (activeCount > 0 ? (
              <>
                {globalPaused ? (
                  <button type="button" className="resume-btn" onClick={resumeAll}>
                    ▶ 全部恢复
                  </button>
                ) : (
                  <button type="button" className="pause-btn" onClick={pauseAll}>
                    ⏸ 全部暂停
                  </button>
                )}
                <button type="button" className="cancel-btn" onClick={cancelAll}>
                  ✖ 取消全部
                </button>
              </>
            ) : pendingCount > 0 || errorCount > 0 ? (
              <button type="button" className="upload-btn" onClick={startAllUploads}>
                开始上传
              </button>
            ) : successCount > 0 ? (
              <button type="button" className="continue-btn" onClick={resetAll}>
                ✓ 上传完成，继续上传更多文件
              </button>
            ) : null)}
        </div>

        {items.length > 0 && (
          <div className="stats-bar">
            <div>
              总速度: <span>{formatSpeed(totalSpeed)}</span>
            </div>
            <div>
              已完成: <span>{successCount}</span> / <span>{items.length}</span> 个文件
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default UploadPage;
