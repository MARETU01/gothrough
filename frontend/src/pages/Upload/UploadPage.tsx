import React, { useEffect } from "react";
import { useUploadQueue } from "@/hooks/useUploadQueue";
import { Link } from "react-router-dom";
import { UploadFileRow } from "./UploadFileRow";
import { formatSpeed } from "@/utils/format";
import { getFileKey } from "@/utils/upload";
import "./UploadPage.css";

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
  } = useUploadQueue();

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
        <p className="subtitle">支持大文件分块上传，可在当前页面暂停和恢复</p>

        <div className="nav-links">
          <Link to="/files">📦 查看已上传文件</Link>
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
              📁
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
            <div className={`status-message ${status.type}`}>{status.text}</div>
          )}
        </div>
        <div className="button-container">
          {items.length > 0 &&
            (activeCount > 0 ? (
              <>
                {canceling ? (
                  <span role="status">正在取消，请稍候…</span>
                ) : globalPaused ? (
                  <button
                    type="button"
                    className="resume-btn"
                    onClick={resumeAll}
                  >
                    ▶ 全部恢复
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pause-btn"
                    onClick={pauseAll}
                  >
                    ⏸ 全部暂停
                  </button>
                )}
                <button
                  type="button"
                  className="cancel-btn"
                  disabled={canceling}
                  onClick={cancelAll}
                >
                  ✖ 取消全部
                </button>
              </>
            ) : pendingCount > 0 || errorCount > 0 ? (
              <button
                type="button"
                className="upload-btn"
                onClick={startAllUploads}
              >
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
