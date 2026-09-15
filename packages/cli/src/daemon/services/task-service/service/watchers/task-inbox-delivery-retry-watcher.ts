import { createRetryTimerWatcher, type RetryTimerWatcher } from './retry-timer-watcher.js';

const DELIVERY_RETRY_DELAY_MS = 1_000;

export type TaskInboxDeliveryRetryWatcher = RetryTimerWatcher;

/**
 * Watches for task-inbox delivery failures.
 *
 * This is a short-lived retry for an exception thrown while the daemon is
 * handling an inbox event. It is deliberately separate from the 10-second
 * pending-task reconciliation watcher: this watcher retries the same inbox
 * event, while reconciliation recomputes the task's current state.
 */
export function createTaskInboxDeliveryRetryWatcher(deps: {
  isStopped: () => boolean;
  hasPendingEvent: (eventId: string) => boolean;
  retry: (eventId: string) => void;
}): TaskInboxDeliveryRetryWatcher {
  return createRetryTimerWatcher({ ...deps, delayMs: DELIVERY_RETRY_DELAY_MS });
}
