import { createContext, useContext } from 'react';
import type { useUploadQueue } from '@/hooks/useUploadQueue';

export const UploadQueueContext = createContext<ReturnType<typeof useUploadQueue> | null>(null);

export function useSharedUploadQueue() {
  const queue = useContext(UploadQueueContext);
  if (!queue) throw new Error('UploadQueueProvider is required');
  return queue;
}
