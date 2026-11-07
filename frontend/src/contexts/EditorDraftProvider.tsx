import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EditorDraftContext, type EditorDraft } from './EditorDraftContext';

// Memory only, outside the access gate. Authentication expiry must not erase
// a draft, and its original version must survive to retain conflict detection.
export function EditorDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  const remember = useCallback((next: EditorDraft) => {
    setDraft(next.text === next.info.text ? null : next);
  }, []);
  const discard = useCallback((name: string) => {
    setDraft(current => current?.name === name ? null : current);
  }, []);
  const value = useMemo(() => ({ draft, remember, discard }), [draft, remember, discard]);
  return <EditorDraftContext.Provider value={value}>{children}</EditorDraftContext.Provider>;
}

