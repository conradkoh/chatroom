import { createRetryTimerWatcher, type RetryTimerWatcher } from './retry-timer-watcher.js';

const ACKNOWLEDGEMENT_RETRY_DELAY_MS = 1_000;

export type TaskInboxAcknowledgementRetryWatcher = RetryTimerWatcher;

/**
 * Watches for task-inbox acknowledgement failures.
 *
 * Acknowledgement is intentionally retried independently from delivery. If
 * delivery already succeeded but Convex did not accept the processed marker,
 * this watcher retries only the marker and never re-injects the task.
 */
export function createTaskInboxAcknowledgementRetryWatcher(deps: {
  isStopped: () => boolean;
  hasPendingEvent: (eventId: string) => boolean;
  retry: (eventId: string) => void;
}): TaskInboxAcknowledgementRetryWatcher {
  return createRetryTimerWatcher({ ...deps, delayMs: ACKNOWLEDGEMENT_RETRY_DELAY_MS });
}
