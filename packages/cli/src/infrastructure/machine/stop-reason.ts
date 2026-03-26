/**
 * Stop Reason Classification
 *
 * Maps process exit info (code, signal) to a semantic stop reason.
 * This is a pure function — no side effects, easily testable.
 */

/**
 * Why an agent process stopped.
 *
 * Combines command-level intent reasons (user.stop, platform.*, daemon.respawn)
 * with process-level outcomes (agent_process.*).
 *
 * Command-level reasons are set by the caller (doStop) and passed directly.
 * Process-level reasons are derived by resolveStopReason from exit info.
 */
export type StopReason =
  | 'user.stop' // User explicitly stopped via UI
  | 'platform.dedup' // Platform stopped duplicate agent for same role
  | 'platform.team_switch' // Platform stopped agent due to team change
  | 'daemon.respawn' // Daemon killed to spawn fresh agent — NOT user-initiated
  | 'daemon.shutdown' // Daemon shutting down (SIGINT/SIGTERM/SIGHUP) — NOT user-initiated
  | 'agent_process.exited_clean' // Exit code 0 without prior stop request (unexpected clean exit)
  | 'agent_process.signal' // Killed by external signal (SIGTERM, SIGKILL, etc.)
  | 'agent_process.crashed' // Non-zero exit code, unknown cause
  | 'test'; // Used in integration and unit tests only

/**
 * Resolves how an agent process stopped based on exit info.
 *
 * Priority order:
 * 1. Signal exits — SIGTERM, SIGKILL, etc.
 * 2. Clean exit (code 0) — unexpected natural completion
 * 3. Non-zero exit — crash or error
 */
export function resolveStopReason(
  code: number | null,
  signal: string | null
): StopReason {
  if (signal !== null) return 'agent_process.signal';
  if (code === 0) return 'agent_process.exited_clean';
  return 'agent_process.crashed';
}
