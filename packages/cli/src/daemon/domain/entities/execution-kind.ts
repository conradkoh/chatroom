export type ExecutionKind = 'team_agent' | 'daemon_worker';

/** Must stay in sync with backend test comments in task-transition-matrix.spec.ts */
export const DAEMON_WORKER_ROLES = new Set<string>();

/** Unknown roles default to team_agent — add new daemon workers to DAEMON_WORKER_ROLES explicitly. */
export function getExecutionKindForRole(role: string): ExecutionKind {
  return DAEMON_WORKER_ROLES.has(role.toLowerCase()) ? 'daemon_worker' : 'team_agent';
}

export function isTeamAgentRole(role: string): boolean {
  return getExecutionKindForRole(role) === 'team_agent';
}

export function isDaemonWorkerRole(role: string): boolean {
  return getExecutionKindForRole(role) === 'daemon_worker';
}
