/** Monotonic stopwatch: repeated pause/resume calls are idempotent. */
export const createElapsedClock = () => {
  let elapsed = 0;
  let since: number | null = null;
  return {
    resume() { if (since === null) since = performance.now(); },
    pause() { if (since !== null) { elapsed += performance.now() - since; since = null; } },
    read() { return elapsed + (since === null ? 0 : performance.now() - since); },
  };
};
