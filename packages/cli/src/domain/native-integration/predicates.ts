import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

/**
 * CLI nudge helpers for get-next-task harnesses.
 * Native SDK delivery eligibility lives in daemon-start/native-ready-invariant.ts
 * (slot + nativeTurnPhase) — do not reintroduce lastSeenAction delivery gates here.
 */

// fallow-ignore-next-line complexity
export function isStaleCliGetNextTaskWaiting(task: AssignedTaskSnapshotView): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  return (
    task.participant?.lastSeenAction === 'get-next-task:started' && task.createdAt > lastSeenAt
  );
}

export function isCliIdleNotListening(
  task: AssignedTaskSnapshotView,
  now: number,
  thresholdMs: number
): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  if (lastSeenAt === 0) return now - task.createdAt > thresholdMs;
  return now - lastSeenAt > thresholdMs;
}
