import React, { useEffect } from "react";
import { useSharedUploadQueue } from "@/contexts/UploadQueueContext";
import { Link } from "react-router-dom";
import { UploadFileRow } from "./UploadFileRow";
import { formatElapsed, formatSpeed } from "@/utils/format";
import { getFileKey } from "@/utils/upload";
import { Button } from "@/components/ui/button";
import { StatusMessage } from "@/components/StatusMessage";
import { FolderOpen, Files, Play, Pause, X, Upload, Check } from "lucide-react";
import "./UploadPage.css";

const UploadPage: React.FC = () => {
  const {
    items,
    globalPaused,
    dragOver,
    setDragOver,
    status,
    totalSpeed,
    queueElapsedMs,
    pendingCount,
    errorCount,
    successCount,
    activeCount,
    running,
    canceling,
    retryItem,
    fileInputRef,
    startAllUploads,
    pauseAll,
    resumeAll,
    cancelAll,
    resetAll,
    removeItem,
    handleSelection,
    openFilePicker,
  } = useSharedUploadQueue();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "文件上传 - 分块上传";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="upload-page">
      <div className="container">
        <h1>文件上传</h1>
        <p className="subtitle">支持大文件分块上传，切换页面后仍会继续，可随时返回暂停和恢复</p>

        <div className="nav-links">
          <Button asChild variant="outline"><Link to="/files"><Files aria-hidden="true" />查看已上传文件</Link></Button>
        </div>

        <div
          className={`upload-area${dragOver ? " dragover" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (
              !(e.relatedTarget instanceof Node) ||
              !e.currentTarget.contains(e.relatedTarget)
            )
              setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length)
              handleSelection(e.dataTransfer.files);
          }}
        >
          <button
            type="button"
            className="upload-trigger"
            onClick={openFilePicker}
            aria-label="选择要上传的文件，支持多选"
          >
            <span className="upload-icon" aria-hidden="true">
              <FolderOpen size={48} aria-hidden="true" />
            </span>
            <span className="upload-text">拖放文件到此处或点击浏览</span>
            <span className="browse-btn">选择文件</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            name="files"
            aria-label="上传文件"
            multiple
            onChange={(e) => {
              const files = e.target.files;
              if (!files || !files.length) return;
              handleSelection(files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="file-list">
          {items.length === 0 ? (
            <div className="empty-hint">
              没有文件，拖放文件到此处或点击"选择文件"按钮
            </div>
          ) : (
            items.map((item) => (
              <UploadFileRow
                key={getFileKey(item.file)}
                item={item}
                retryDisabled={running}
                onRemove={removeItem}
                onRetry={retryItem}
              />
            ))
          )}
        </div>

        <div role="status" aria-live="polite" aria-atomic="true">
          {status && (
            <StatusMessage tone={status.type}>{status.text}</StatusMessage>
          )}
        </div>
        <div className="button-container">
          {items.length > 0 &&
            (activeCount > 0 ? (
              <>
                {canceling ? (
                  <span role="status">正在取消，请稍候…</span>
                ) : globalPaused ? (
                  <Button
                    type="button"
                    variant="default" size="lg"
                    onClick={resumeAll}
                  >
                    <Play aria-hidden="true" />全部恢复
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline" size="lg"
                    onClick={pauseAll}
                  >
                    <Pause aria-hidden="true" />全部暂停
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive" size="lg"
                  disabled={canceling}
                  onClick={cancelAll}
                >
                  <X aria-hidden="true" />取消全部
                </Button>
              </>
            ) : pendingCount > 0 || errorCount > 0 ? (
              <Button
                type="button"
                variant="default" size="lg"
                onClick={startAllUploads}
              >
                <Upload aria-hidden="true" />开始上传
              </Button>
            ) : successCount > 0 ? (
              <Button type="button" variant="default" size="lg" onClick={resetAll}>
                <Check aria-hidden="true" />继续上传更多文件
              </Button>
            ) : null)}
        </div>

        {items.length > 0 && (
          <div className="stats-bar">
            {queueElapsedMs !== null && <div title="本轮队列耗时，不含暂停时间">总耗时: <span>{formatElapsed(queueElapsedMs)}</span>（不含暂停）</div>}
            <div>
              总速度: <span>{formatSpeed(totalSpeed)}</span>
            </div>
            <div>
              已完成: <span>{successCount}</span> / <span>{items.length}</span>{" "}
              个文件
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default UploadPage;
