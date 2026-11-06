import { translateMessage } from '@/i18n/messages';
import { useTranslation } from 'react-i18next';
import { memo } from "react";
import { STATE_LABELS, type UploadViewItem } from "@/types/upload";
import { formatElapsed, formatETA, formatSize, formatSpeed } from "@/utils/format";
import { getFileKey } from "@/utils/upload";
import { getUploadPath } from "@/utils/droppedFiles";

import { Button } from "@/components/ui/button";
import { RotateCcw, X } from "lucide-react";

type Props = {
  item: UploadViewItem;
  retryDisabled: boolean;
  onRemove: (fileKey: string) => void;
  onRetry: (fileKey: string) => Promise<void>;
};

export const UploadFileRow = memo(function UploadFileRow({
  item,
  retryDisabled,
  onRemove,
  onRetry,
}: Props) {
  const { t } = useTranslation();
  const key = getFileKey(item.file);
  const displayName = getUploadPath(item.file);
  const progress =
    item.state === "success"
      ? 100
      : item.file.size
        ? Math.min(100, Math.round((item.loadedBytes / item.file.size) * 100))
        : 0;
  const eta =
    item.state === "uploading" && item.speed > 0
      ? formatETA(Math.max(0, item.file.size - item.loadedBytes), item.speed)
      : "";
  return (
    <div className={`file-row ${item.state}`}>
      <div className="file-meta">
        <div className="file-label">
          <div className="file-name" title={displayName}>
            {displayName}
          </div>
          <div className="file-size">{formatSize(item.file.size)}</div>
        </div>
        <Button
          type="button"
          variant="ghost" size="sm"
          aria-label={t('upload.remove', { name: displayName })}
          disabled={item.state === "canceling"}
          onClick={() => onRemove(key)}
        >
          <X aria-hidden="true" />{t("移除")}</Button>
      </div>
      {item.error && (
        <p className="file-error" role="alert">
          {translateMessage(item.error)}
        </p>
      )}
      {item.state === "error" && (
        <Button
          type="button"
          variant="outline" size="sm"
          aria-label={t('upload.retry', { name: displayName })}
          disabled={retryDisabled}
          onClick={() => void onRetry(key)}
        >
          <RotateCcw aria-hidden="true" />{t("重试此文件")}</Button>
      )}
      <div className="file-status">
        <span>{t(STATE_LABELS[item.state])}</span>
        {item.elapsedMs !== null && <span title={t("不含暂停时间；重试后重新计时")}>{t("耗时")} {formatElapsed(item.elapsedMs)}</span>}
        {item.speed > 0 && (
          <span className="speed">{formatSpeed(item.speed)}</span>
        )}
        {eta && <span className="eta">{t("剩余")}{eta}</span>}
        {item.session && (
          <span className="chunks">{t("分块")}{item.session.receivedChunks}/{item.session.totalChunks}
          </span>
        )}
      </div>
      <div
        className="progress-bar"
        role="progressbar"
        aria-label={t('upload.progress', { name: displayName })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={t('upload.progressText', { progress, state: t(STATE_LABELS[item.state]) })}
      >
        <div className="progress" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">
        <span>{progress}%</span>
        <span title={item.savedFilename}>{item.savedFilename}</span>
      </div>
    </div>
  );
});
