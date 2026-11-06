import api, { responseApi } from './http';

export const CLIPBOARD_MAX_BYTES = 64 * 1024;
export const CLIPBOARD_MAX_ENTRIES = 100;

export interface ClipboardEntry {
  id: string;
  text: string;
  created_at: string;
}

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
