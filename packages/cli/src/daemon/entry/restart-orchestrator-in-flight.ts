/**
 * Per-(chatroomId, role) in-flight registry for restart orchestrator.
 * Prevents TaskMonitor and delivery coordinator from racing during user restart.
 */

function roleKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

const inFlight = new Map<string, string>(); // roleKey → correlationId

export function markRestartOrchestratorInFlight(
  chatroomId: string,
  role: string,
  correlationId: string
): void {
  inFlight.set(roleKey(chatroomId, role), correlationId);
}

export function clearRestartOrchestratorInFlight(
  chatroomId: string,
  role: string,
  correlationId?: string
): void {
  const key = roleKey(chatroomId, role);
  if (correlationId !== undefined && inFlight.get(key) !== correlationId) return;
  inFlight.delete(key);
}

export function isRestartOrchestratorInFlight(chatroomId: string, role: string): boolean {
  return inFlight.has(roleKey(chatroomId, role));
}

export function filterSnapshotsExcludingRestartInFlight<
  T extends { chatroomId: string; agentConfig: { role: string } },
>(snapshots: T[]): T[] {
  return snapshots.filter(
    (row) => !isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)
  );
}

/** Test-only */
export function _resetRestartOrchestratorInFlightForTests(): void {
  inFlight.clear();
}
