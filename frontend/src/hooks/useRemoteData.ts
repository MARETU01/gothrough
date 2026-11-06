import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/services/errors';

// Only the latest request can update the page. Cancel before mutations so an
// older list response cannot bring deleted records back into view.
export function useRemoteData<T>(load: (signal?: AbortSignal) => Promise<T>, initialData: T) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [backgroundError, setBackgroundError] = useState('');
  const mounted = useRef(false);
  const request = useRef<{ controller: AbortController; background: boolean } | null>(null);

  const setError = useCallback((message: string) => {
    setActionError(message);
    setLoadError('');
  }, []);

  const cancel = useCallback(() => {
    request.current?.controller.abort();
    request.current = null;
    if (mounted.current) setLoading(false);
  }, []);

  const cancelBackground = useCallback(() => {
    if (request.current?.background) {
      request.current.controller.abort();
      request.current = null;
    }
  }, []);

  const refresh = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!mounted.current) return;
    // Polling never interrupts an initial load, manual refresh, or another poll.
    if (background && request.current) return;
    request.current?.controller.abort();
    const controller = new AbortController();
    request.current = { controller, background };
    if (!background) {
      setLoading(true);
      setError('');
      setLoadError('');
      setBackgroundError('');
    }
    try {
      const result = await load(controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setData(result);
        setLoadError('');
        setBackgroundError('');
      }
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) {
        if (background) setBackgroundError(apiErrorMessage(err));
        else setLoadError(apiErrorMessage(err));
      }
    } finally {
      if (request.current?.controller === controller) request.current = null;
      if (!background && mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, [load, setError]);

  useEffect(() => {
    mounted.current = true;
    // Loading remote state on mount is intentional; refresh cancels stale work.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh();
    return () => {
      mounted.current = false;
      request.current?.controller.abort();
      request.current = null;
    };
  }, [refresh]);

  return { data, setData, loading, error: actionError || loadError, setError, backgroundError, refresh, cancel, cancelBackground, mounted };
}
