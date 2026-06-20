/**
 * Why an agent process stopped.
 *
 * Command-level reasons are set by the caller (doStop) and passed directly.
 * Process-level reasons are derived by resolveStopReason from exit info.
 */
export type StopReason =
  | 'user.stop'
  | 'platform.dedup'
  | 'platform.task_monitor_nudge'
  | 'platform.team_switch'
  | 'platform.resume_storm'
  | 'daemon.respawn'
  | 'daemon.shutdown'
  | 'agent_process.exited_clean'
  | 'agent_process.signal'
  | 'agent_process.crashed'
  | 'test';

export function resolveStopReason(code: number | null, signal: string | null): StopReason {
  if (signal !== null) return 'agent_process.signal';
  if (code === 0) return 'agent_process.exited_clean';
  return 'agent_process.crashed';
}
