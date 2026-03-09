/**
 * Stop Reason Classification
 *
 * Maps process exit info (code, signal, wasIntentional) to a semantic stop reason.
 * This is a pure function — no side effects, easily testable.
 */

/** Why an agent process stopped. */
export type StopReason =
  | 'user.stop'                    // User explicitly stopped via UI
  | 'daemon.respawn'               // Daemon killed to spawn fresh agent (ensure-agent-retry) — NOT user-initiated
  | 'agent_process.exited_clean'   // Exit code 0 without prior stop request (unexpected clean exit)
  | 'agent_process.signal'         // Killed by external signal (SIGTERM, SIGKILL, etc.)
  | 'agent_process.crashed';       // Non-zero exit code, unknown cause

/**
 * Resolves how an agent process stopped.
 *
 * Priority order:
 * 1. wasIntentional wins — if the daemon marked this as intentional, it's intentional.
 * 2. Signal exits — SIGTERM, SIGKILL, etc. (includes daemon-sent SIGTERM NOT preceded by mark)
 * 3. Clean exit (code 0) — unexpected natural completion
 * 4. Non-zero exit — crash or error
 */
export function resolveStopReason(
  code: number | null,
  signal: string | null,
  wasIntentional: boolean
): StopReason {
  if (wasIntentional) return 'user.stop';
  if (signal !== null) return 'agent_process.signal';
  if (code === 0) return 'agent_process.exited_clean';
  return 'agent_process.crashed';
}
