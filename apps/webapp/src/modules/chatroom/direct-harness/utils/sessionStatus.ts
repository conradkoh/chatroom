import type { HarnessSessionStatus } from '@workspace/backend/src/domain/direct-harness/types';

/** Apply client-side closed status while the daemon processes a close command. */
export function effectiveSessionStatus(
  status: HarnessSessionStatus,
  sessionId: string,
  optimisticallyClosedIds: ReadonlySet<string>
): HarnessSessionStatus {
  return optimisticallyClosedIds.has(sessionId) ? 'closed' : status;
}

export function isTerminalSessionStatus(status: HarnessSessionStatus): boolean {
  return status === 'closed' || status === 'failed';
}

/** Remove optimistic closed IDs once Convex reports a terminal status. */
export function pruneConfirmedClosedIds(
  optimisticIds: ReadonlySet<string>,
  sessions: { _id: string; status: HarnessSessionStatus }[]
): Set<string> | null {
  const terminalIds = new Set(
    sessions.filter((s) => isTerminalSessionStatus(s.status)).map((s) => s._id)
  );
  const next = new Set([...optimisticIds].filter((id) => !terminalIds.has(id)));
  return next.size < optimisticIds.size ? next : null;
}
