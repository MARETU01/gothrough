import api from './http';
import { conditionalGet } from './conditional';

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
  files: FileBrowserEntry[];
  total_size_display: string;
  directory: string;
  total: number;
  folder_count: number;
  total_files: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface FileBrowserQuery { directory: string; search: string; sort: string; page: number; pageSize: number; refresh?: boolean }
export interface FileBrowserEntry extends UploadedFile { folder: boolean; label: string }

export type FileListResult = (FileListData & { notModified?: false; etag?: string })
  | { notModified: true; etag?: string };

export const listFiles = async (signal?: AbortSignal, etag?: string, query?: FileBrowserQuery): Promise<FileListResult> => {
  const params = query ? new URLSearchParams({ view: 'browser', dir: query.directory, q: query.search,
    sort: query.sort, page: String(query.page), page_size: String(query.pageSize) }) : new URLSearchParams({ view: 'browser' });
  if (query?.refresh) params.set('refresh', '1');
  const result = await conditionalGet<FileListData>('/files?' + params, signal, etag);
  return result.notModified ? result : { ...result.data, etag: result.etag };
};

export const getDiskInfo = (signal?: AbortSignal) => api.get<DiskInfo, DiskInfo>('/disk-info', { signal });

export const downloadFileUrl = (name: string) => '/api/files/' + encodeURIComponent(name);

export interface FileSelection { path: string; folder: boolean }
export interface DeleteSelectionResult { path: string; deleted: boolean; code?: string; error?: string }
export const deleteSelection = (entries: FileSelection[], signal?: AbortSignal) =>
  api.post<{ results: DeleteSelectionResult[] }, { results: DeleteSelectionResult[] }>('/batch-delete', { entries }, { signal, timeout: 0 });
export const downloadSelectionUrl = (paths: string[]) => {
  const query = new URLSearchParams();
  paths.forEach(path => query.append('path', path));
  return '/api/batch-download?' + query;
};

export interface FilePreviewInfo {
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'spreadsheet';
  mime_type: string;
  text: string;
  version?: string;
}
export interface SpreadsheetCell { value: string; raw: string; type: 'text' | 'number' | 'boolean' | 'readonly'; formula?: string }
export interface SpreadsheetSheet { name: string; rows: number; columns: number; read_only: boolean; cells: Record<string, SpreadsheetCell> }
export interface SpreadsheetPreview extends FilePreviewInfo { kind: 'spreadsheet'; version: string; sheets: SpreadsheetSheet[] }
export interface SpreadsheetChange { sheet: string; cell: string; type: 'text' | 'number' | 'boolean' | 'clear'; value: string }
export interface SpreadsheetSaveAttempt { id: string; version: string; changes: SpreadsheetChange[]; confirmedVersion?: string }
export interface SpreadsheetSaveResult { status: 'saved' | 'pending' | 'unknown'; version?: string; preview?: SpreadsheetPreview }
function createSaveID() {
  // getRandomValues also works on HTTP LAN origins where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function createSpreadsheetSaveAttempt(version: string, changes: SpreadsheetChange[]): SpreadsheetSaveAttempt {
  return { id: createSaveID(), version, changes: changes.map(change => ({ ...change })) };
}
export interface TextSaveAttempt { id: string; version: string; text: string; confirmedVersion?: string }
export type TextSaveResult = Pick<SpreadsheetSaveResult, 'status' | 'version'>;
export const createTextSaveAttempt = (version: string, text: string): TextSaveAttempt => ({ id: createSaveID(), version, text });
export const saveTextOperation = (name: string, attempt: TextSaveAttempt) =>
  api.put<TextSaveResult, TextSaveResult>('/files/' + encodeURIComponent(name), { operation_id: attempt.id, version: attempt.version, text: attempt.text }, { timeout: 0 });
export const getTextSaveStatus = (name: string, id: string, signal?: AbortSignal) =>
  api.get<TextSaveResult, TextSaveResult>('/text-saves/' + encodeURIComponent(id), { params: { filename: name }, signal });
export const saveSpreadsheetOperation = (name: string, attempt: SpreadsheetSaveAttempt) =>
  api.put<SpreadsheetSaveResult, SpreadsheetSaveResult>('/spreadsheets/' + encodeURIComponent(name), { operation_id: attempt.id, version: attempt.version, changes: attempt.changes }, { timeout: 0 });
export const getSpreadsheetSaveStatus = (name: string, id: string, signal?: AbortSignal) =>
  api.get<SpreadsheetSaveResult, SpreadsheetSaveResult>('/spreadsheet-saves/' + encodeURIComponent(id), { params: { filename: name }, signal });
export const getSpreadsheetPreview = (name: string, signal?: AbortSignal) =>
  api.get<SpreadsheetPreview, SpreadsheetPreview>('/files/' + encodeURIComponent(name) + '?preview=info', { signal });
export const saveSpreadsheet = (name: string, version: string, changes: SpreadsheetChange[]) =>
  api.put<SpreadsheetPreview, SpreadsheetPreview>('/spreadsheets/' + encodeURIComponent(name), { version, changes }, { timeout: 0 });
export const previewFileUrl = (name: string) => downloadFileUrl(name) + '?preview=1';
export const getFilePreview = (name: string, signal?: AbortSignal) =>
  api.get<FilePreviewInfo, FilePreviewInfo>('/files/' + encodeURIComponent(name) + '?preview=info', { signal });
export const saveFileText = (name: string, text: string, version: string) =>
  api.put<{ version: string }, { version: string }>('/files/' + encodeURIComponent(name), { text, version });
