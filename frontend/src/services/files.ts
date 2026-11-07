import api, { responseApi } from './http';

export interface UploadedFile {
  name: string;
  size: number;
  size_display: string;
  mtime: string;
}

export interface DiskInfo {
  disk_free_display: string;
  disk_used_display: string;
  disk_total_display: string;
  disk_pct: number;
  disk_pct_warning: boolean;
}

export interface FileListData {
  files: UploadedFile[];
  total_size_display: string;
}

// Original combined response remains supported by the backend.
export interface FileListResponse extends FileListData, DiskInfo {}
export type FileListResult = (FileListData & Partial<DiskInfo> & { notModified?: false; etag?: string })
  | { notModified: true; etag?: string };

export const listFiles = async (signal?: AbortSignal, etag?: string): Promise<FileListResult> => {
  const response = await responseApi.get<FileListData>('/files?view=list', {
    signal,
    headers: etag ? { 'If-None-Match': etag } : undefined,
    validateStatus: status => (status >= 200 && status < 300) || (status === 304 && !!etag),
  });
  const nextEtag = response.headers.etag as string | undefined;
  return response.status === 304 ? { notModified: true, etag: nextEtag ?? etag }
    : { ...response.data, etag: nextEtag };
};

export const getDiskInfo = (signal?: AbortSignal) => api.get<DiskInfo, DiskInfo>('/disk-info', { signal });

export const deleteFile = (name: string) => api.delete<{ status: string }, { status: string }>('/files/' + encodeURIComponent(name));
export const downloadFileUrl = (name: string) => '/api/files/' + encodeURIComponent(name);

export interface FilePreviewInfo {
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'video';
  mime_type: string;
  text: string;
  version?: string;
}
export const previewFileUrl = (name: string) => downloadFileUrl(name) + '?preview=1';
export const getFilePreview = (name: string, signal?: AbortSignal) =>
  api.get<FilePreviewInfo, FilePreviewInfo>('/files/' + encodeURIComponent(name) + '?preview=info', { signal });
export const saveFileText = (name: string, text: string, version: string) =>
  api.put<{ version: string }, { version: string }>('/files/' + encodeURIComponent(name), { text, version });
