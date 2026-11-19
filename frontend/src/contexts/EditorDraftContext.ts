import { createContext, useContext } from 'react';
import type { FilePreviewInfo, SpreadsheetChange, SpreadsheetPreview, SpreadsheetSaveAttempt, TextSaveAttempt } from '@/services/files';

interface TextEditorDraft {
  kind?: 'text';
  name: string;
  info: FilePreviewInfo;
  text: string;
  operation?: TextSaveAttempt;
}

interface SpreadsheetEditorDraft {
  kind: 'spreadsheet';
  name: string;
  info: SpreadsheetPreview;
  text: '';
  changes: SpreadsheetChange[];
  operation?: SpreadsheetSaveAttempt;
}
export type EditorDraft = TextEditorDraft | SpreadsheetEditorDraft;

export const EditorDraftContext = createContext<{
  draft: EditorDraft | null;
  remember: (draft: EditorDraft) => void;
  discard: (name: string) => void;
}>({ draft: null, remember: () => {}, discard: () => {} });

export const useEditorDraft = () => useContext(EditorDraftContext);
