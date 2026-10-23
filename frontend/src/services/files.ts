import api from './http';

export interface UploadedFile {
  name: string;
  size: number;
  size_display: string;
  mtime: string;
}

export interface FileListResponse {
  files: UploadedFile[];
  total_size_display: string;
  disk_free_display: string;
  disk_used_display: string;
  disk_total_display: string;
  disk_pct: number;
  disk_pct_warning: boolean;
}

export const listFiles = (signal?: AbortSignal) =>
  api.get<FileListResponse, FileListResponse>('/files', { signal });

export const deleteFile = (name: string) => api.post<{ status: string }, { status: string }>('/delete/' + encodeURIComponent(name));
export const downloadFileUrl = (name: string) => '/api/uploads/' + encodeURIComponent(name);
