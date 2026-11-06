import { useEffect } from 'react';

// Wait until each refresh settles before scheduling the next one. Hidden pages
// and paused interactions cancel background work; foreground loads are untouched.
export function useAutoRefresh(refresh: () => Promise<void>, interval: number, enabled: boolean, cancel: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const cycle = {
      disposed: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      sequence: 0,
      running: false,
    };

    const stop = () => {
      clearTimeout(cycle.timer);
      cycle.sequence++;
      cycle.running = false;
      cancel();
    };
    const schedule = () => {
      if (!cycle.disposed && document.visibilityState !== 'hidden') cycle.timer = setTimeout(() => void tick(), interval);
    };
    const tick = async () => {
      if (cycle.disposed || cycle.running || document.visibilityState === 'hidden') return;
      cycle.running = true;
      const current = ++cycle.sequence;
      try {
        await refresh();
      } finally {
        if (!cycle.disposed && current === cycle.sequence) {
          cycle.running = false;
          schedule();
        }
      }
    };
    const onVisibilityChange = () => {
      stop();
      if (document.visibilityState !== 'hidden') void tick();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cycle.disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh, interval, enabled, cancel]);
}
