import { translateMessage } from '@/i18n/messages';
import { useTranslation } from 'react-i18next';
import type React from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
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
  const { t } = useTranslation();
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
    handleDrop,
    readingFolders,
    openFilePicker,
  } = useSharedUploadQueue();

  usePageTitle(t("文件上传 - 分块上传"));

  return (
    <main className="upload-page">
      <div className="container">
        <h1>{t("文件上传")}</h1>
        <p className="subtitle">{t("支持拖入文件夹并保留目录结构，切换页面后仍会继续上传")}</p>

        <div className="nav-links">
          <Button asChild variant="outline"><Link to="/files"><Files aria-hidden="true" />{t("查看已上传文件")}</Link></Button>
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
            void handleDrop(e.dataTransfer);
          }}
        >
          <button
            type="button"
            className="upload-trigger"
            onClick={openFilePicker}
            aria-label={t("选择要上传的文件，支持多选")}
          >
            <span className="upload-icon" aria-hidden="true">
              <FolderOpen size={48} aria-hidden="true" />
            </span>
            <span className="upload-text">{t("拖放文件或文件夹到此处或点击浏览")}</span>
            <span className="browse-btn">{t("选择文件")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            name="files"
            aria-label={t("上传文件")}
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
            <div className="empty-hint">{t("拖放文件或文件夹，或点击\"选择文件\"按钮；空文件夹不会上传")}</div>
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
          {readingFolders && <StatusMessage tone="loading">{t("正在读取拖入的文件夹…")}</StatusMessage>}
          {status && (
            <StatusMessage tone={status.type}>{translateMessage(status.text)}</StatusMessage>
          )}
        </div>
        <div className="button-container">
          {items.length > 0 &&
            (activeCount > 0 ? (
              <>
                {canceling ? (
                  <span role="status">{t("正在取消，请稍候…")}</span>
                ) : globalPaused ? (
                  <Button
                    type="button"
                    variant="default" size="lg"
                    onClick={resumeAll}
                  >
                    <Play aria-hidden="true" />{t("全部恢复")}</Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline" size="lg"
                    onClick={pauseAll}
                  >
                    <Pause aria-hidden="true" />{t("全部暂停")}</Button>
                )}
                <Button
                  type="button"
                  variant="destructive" size="lg"
                  disabled={canceling}
                  onClick={cancelAll}
                >
                  <X aria-hidden="true" />{t("取消全部")}</Button>
              </>
            ) : pendingCount > 0 || errorCount > 0 ? (
              <Button
                type="button"
                variant="default" size="lg"
                onClick={startAllUploads}
                disabled={readingFolders}
              >
                <Upload aria-hidden="true" />{t("开始上传")}</Button>
            ) : successCount > 0 ? (
              <Button type="button" variant="default" size="lg" onClick={resetAll}>
                <Check aria-hidden="true" />{t("继续上传更多文件")}</Button>
            ) : null)}
        </div>

        {items.length > 0 && (
          <div className="stats-bar">
            {queueElapsedMs !== null && <div title={t("本轮队列耗时，不含暂停时间")}>{t("总耗时:")}<span>{formatElapsed(queueElapsedMs)}</span>{t("（不含暂停）")}</div>}
            <div>{t("总速度:")}<span>{formatSpeed(totalSpeed)}</span>
            </div>
            <div>{t("已完成:")}<span>{successCount}</span> / <span>{items.length}</span>{" "}{t("个文件")}</div>
          </div>
        )}
      </div>
    </main>
  );
};

export default UploadPage;
