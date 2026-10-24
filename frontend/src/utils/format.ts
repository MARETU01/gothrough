/** 字节数格式化为带单位的可读字符串，如 1.5 MB */
export const formatSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.max(0, Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k))));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/** 速度（字节/秒）格式化为 1.5 MB/s */
export const formatSpeed = (bytesPerSec: number) => `${formatSize(bytesPerSec)}/s`;

/** Elapsed duration keeps tenths of a second so short uploads remain visible. */
export const formatElapsed = (milliseconds: number) => {
  const tenths = Math.floor(Math.max(0, milliseconds) / 100);
  const seconds = (tenths % 600) / 10;
  const minutes = Math.floor(tenths / 600) % 60;
  const hours = Math.floor(tenths / 36000);
  return `${hours ? `${hours}时` : ''}${hours || minutes ? `${minutes}分` : ''}${seconds.toFixed(1)}秒`;
};

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
