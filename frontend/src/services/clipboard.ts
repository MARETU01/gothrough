import api, { responseApi } from './http';
import { conditionalGet } from './conditional';

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
  const result = await conditionalGet<ClipboardListResponse>('/clipboard', signal, etag);
  return result.notModified ? result : { entries: result.data.entries, etag: result.etag };
};

export const createClipboard = (text: string) =>
  api.post<ClipboardEntry, ClipboardEntry>('/clipboard', { text });

export const deleteClipboard = (id: string) =>
  api.delete<{ status: string }, { status: string }>('/clipboard/' + encodeURIComponent(id));

export const clearClipboard = () =>
  api.delete<{ status: string }, { status: string }>('/clipboard');
