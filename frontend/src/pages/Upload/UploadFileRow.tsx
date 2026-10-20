import { memo } from 'react';
import { STATE_LABELS, type UploadViewItem } from '@/types/upload';
import { formatETA, formatSize, formatSpeed } from '@/utils/format';
import { getFileKey } from '@/utils/upload';

type Props = {
  item: UploadViewItem;
  retryDisabled: boolean;
  onRemove: (fileKey: string) => void;
  onRetry: (fileKey: string) => Promise<void>;
};

export const UploadFileRow = memo(function UploadFileRow({ item, retryDisabled, onRemove, onRetry }: Props) {
  const key = getFileKey(item.file);
  const progress = item.state === 'success' ? 100 : item.file.size
    ? Math.min(100, Math.round(item.loadedBytes / item.file.size * 100)) : 0;
  const eta = item.state === 'uploading' && item.speed > 0
    ? formatETA(Math.max(0, item.file.size - item.loadedBytes), item.speed) : '';
  return (
    <div className={`file-row ${item.state}`}>
      <div className="file-meta">
        <div className="file-label">
          <div className="file-name" title={item.file.name}>{item.file.name}</div>
          <div className="file-size">{formatSize(item.file.size)}</div>
        </div>
        <button type="button" className="remove-btn" aria-label={`移除 ${item.file.name}`} disabled={item.state === 'canceling'} onClick={() => onRemove(key)}>移除</button>
      </div>
      {item.error && <p className="file-error" role="alert">{item.error}</p>}
      {item.state === 'error' && (
        <button type="button" className="retry-btn" aria-label={`重试 ${item.file.name}`} disabled={retryDisabled} onClick={() => void onRetry(key)}>重试此文件</button>
      )}
      <div className="file-status">
        <span>{STATE_LABELS[item.state]}</span>
        {item.speed > 0 && <span className="speed">{formatSpeed(item.speed)}</span>}
        {eta && <span className="eta">剩余 {eta}</span>}
        {item.session && <span className="chunks">分块 {item.session.receivedChunks}/{item.session.totalChunks}</span>}
      </div>
      <div className="progress-bar" role="progressbar" aria-label={`${item.file.name} 传输进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}%，${STATE_LABELS[item.state]}`}>
        <div className="progress" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-text">
        <span>{progress}%</span>
        <span title={item.savedFilename}>{item.savedFilename}</span>
      </div>
    </div>
  );
});
