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
  maxDelayMs?: number;
  isStopped: () => boolean;
  hasPendingEvent: (eventId: string) => boolean;
  retry: (eventId: string) => void;
}): RetryTimerWatcher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  const maxDelayMs = deps.maxDelayMs ?? deps.delayMs * 32;

  const canSchedule = (eventId: string): boolean =>
    !deps.isStopped() && !timers.has(eventId) && deps.hasPendingEvent(eventId);

  const schedule = (eventId: string): void => {
    if (!canSchedule(eventId)) return;

    const attempt = attempts.get(eventId) ?? 0;
    const delayMs = Math.min(deps.delayMs * 2 ** attempt, maxDelayMs);
    attempts.set(eventId, attempt + 1);
    const timer = setTimeout(() => {
      timers.delete(eventId);
      deps.retry(eventId);
    }, delayMs);
    unrefTimer(timer);
    timers.set(eventId, timer);
  };

  const clear = (eventId: string): void => {
    const timer = timers.get(eventId);
    if (timer) clearTimeout(timer);
    timers.delete(eventId);
    attempts.delete(eventId);
  };

  const stop = (): void => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    attempts.clear();
  };

  return { schedule, clear, stop };
}
