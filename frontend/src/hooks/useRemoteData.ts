import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/services/errors';

// Only the latest request can update the page. Cancel before mutations so an
// older list response cannot bring deleted records back into view.
export function useRemoteData<T>(load: (signal?: AbortSignal) => Promise<T>, initialData: T) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    request.current?.abort();
    if (mounted.current) setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await load(controller.signal);
      if (mounted.current && !controller.signal.aborted) setData(result);
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) setError(apiErrorMessage(err));
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    // Loading remote state on mount is intentional; refresh cancels stale work.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [refresh]);

  return { data, setData, loading, error, setError, refresh, cancel, mounted };
}
