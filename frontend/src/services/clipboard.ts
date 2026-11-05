import api from './http';

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

export const listClipboard = (signal?: AbortSignal) =>
  api.get<ClipboardListResponse, ClipboardListResponse>('/clipboard', { signal });

export const createClipboard = (text: string) =>
  api.post<ClipboardEntry, ClipboardEntry>('/clipboard', { text });

export const deleteClipboard = (id: string) =>
  api.delete<{ status: string }, { status: string }>('/clipboard/' + encodeURIComponent(id));

export const clearClipboard = () =>
  api.delete<{ status: string }, { status: string }>('/clipboard');
