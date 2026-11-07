import { createContext, useContext } from 'react';
import type { FilePreviewInfo } from '@/services/files';

export interface EditorDraft {
  name: string;
  info: FilePreviewInfo;
  text: string;
}

export const EditorDraftContext = createContext<{
  draft: EditorDraft | null;
  remember: (draft: EditorDraft) => void;
  discard: (name: string) => void;
}>({ draft: null, remember: () => {}, discard: () => {} });

export const useEditorDraft = () => useContext(EditorDraftContext);
