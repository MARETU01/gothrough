import api, { responseApi } from './http';

export const CLIPBOARD_MAX_BYTES = 64 * 1024;
export const CLIPBOARD_MAX_ENTRIES = 100;

export interface ClipboardEntry {
  id: string;
  text: string;
  type?: 'text' | 'image';
  image?: { url: string; mime_type: string; size: number; width: number; height: number };
  created_at: string;
}

export interface ClipboardImageSettings {
  enabled: boolean;
  max_size_mb: number;
  max_pixels: number;
  max_total_size_mb: number;
}

export const getClipboardImageSettings = (signal?: AbortSignal) =>
  api.get<ClipboardImageSettings, ClipboardImageSettings>('/clipboard/image-config', { signal });

export const createClipboardImage = (file: File) => {
  const body = new FormData();
  body.append('image', file);
  return api.post<ClipboardEntry, ClipboardEntry>('/clipboard/image', body);
};

export const fetchClipboardImage = async (id: string) => {
  const response = await responseApi.get<Blob>('/clipboard/' + encodeURIComponent(id) + '/image', { responseType: 'blob' });
  return response.data;
};

export interface ClipboardListResponse {
  entries: ClipboardEntry[];
}

export type ClipboardListResult =
  | (ClipboardListResponse & { notModified?: false; etag?: string })
  | { notModified: true; etag?: string };

export const listClipboard = async (signal?: AbortSignal, etag?: string): Promise<ClipboardListResult> => {
  const response = await responseApi.get<ClipboardListResponse>('/clipboard', {
    signal,
    headers: etag ? { 'If-None-Match': etag } : undefined,
    validateStatus: status => (status >= 200 && status < 300) || (status === 304 && !!etag),
  });
  const nextEtag = response.headers.etag as string | undefined;
  return response.status === 304
    ? { notModified: true, etag: nextEtag ?? etag }
    : { entries: response.data.entries, etag: nextEtag };
};

export const createClipboard = (text: string) =>
  api.post<ClipboardEntry, ClipboardEntry>('/clipboard', { text });

export const deleteClipboard = (id: string) =>
  api.delete<{ status: string }, { status: string }>('/clipboard/' + encodeURIComponent(id));

export const clearClipboard = () =>
  api.delete<{ status: string }, { status: string }>('/clipboard');
