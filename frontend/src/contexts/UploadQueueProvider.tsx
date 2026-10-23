import { createElement, type ReactNode } from 'react';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { UploadQueueContext } from './UploadQueueContext';

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const queue = useUploadQueue();
  return createElement(UploadQueueContext.Provider, { value: queue }, children);
}
