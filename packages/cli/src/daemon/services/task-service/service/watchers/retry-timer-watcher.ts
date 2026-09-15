/**
 * Shared timer mechanics for task-inbox retry watchers. The caller supplies
 * the policy and callback; each watcher instance still owns an independent
 * timer map, so delivery retries and acknowledgement retries cannot interfere.
 */
/** Prevent retry timers from keeping the daemon alive during shutdown. */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  timer.unref?.();
}

export interface RetryTimerWatcher {
  schedule(eventId: string): void;
  clear(eventId: string): void;
  stop(): void;
}

export function createRetryTimerWatcher(deps: {
  delayMs: number;
  isStopped: () => boolean;
  hasPendingEvent: (eventId: string) => boolean;
  retry: (eventId: string) => void;
}): RetryTimerWatcher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const schedule = (eventId: string): void => {
    if (deps.isStopped()) return;
    if (timers.has(eventId)) return;
    if (!deps.hasPendingEvent(eventId)) return;

    const timer = setTimeout(() => {
      timers.delete(eventId);
      deps.retry(eventId);
    }, deps.delayMs);
    unrefTimer(timer);
    timers.set(eventId, timer);
  };

  const clear = (eventId: string): void => {
    const timer = timers.get(eventId);
    if (timer) clearTimeout(timer);
    timers.delete(eventId);
  };

  const stop = (): void => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  return { schedule, clear, stop };
}
