/** 字节数格式化为带单位的可读字符串，如 1.5 MB */
export const formatSize = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/** 速度（字节/秒）格式化为 1.5 MB/s */
export const formatSpeed = (bytesPerSec: number) => `${formatSize(bytesPerSec)}/s`;

/** 剩余时间（ETA）格式化：剩余字节 + 当前速度 → "12秒" / "3分5秒" / "1时12分" */
export const formatETA = (remainingBytes: number, bytesPerSec: number) => {
  if (bytesPerSec <= 0) return '--';
  const secs = Math.ceil(remainingBytes / bytesPerSec);
  if (secs < 60) return `${secs}秒`;
  if (secs < 3600) return `${Math.floor(secs / 60)}分${secs % 60}秒`;
  const hrs = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return `${hrs}时${mins}分`;
};
