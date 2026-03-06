/**
 * Stop Reason Classification
 *
 * Maps process exit info (code, signal, wasIntentional) to a semantic stop reason.
 * This is a pure function — no side effects, easily testable.
 */

/** Why an agent process stopped. */
export type StopReason =
  | 'intentional_stop'               // User explicitly stopped via UI
  | 'daemon_respawn_stop'            // Daemon killed to spawn fresh agent (ensure-agent-retry) — NOT user-initiated
  | 'process_exited_with_success'    // Exit code 0 without prior stop request (unexpected clean exit)
  | 'process_terminated_with_signal' // Killed by external signal (SIGTERM, SIGKILL, etc.)
  | 'process_terminated_unexpectedly'; // Non-zero exit code, unknown cause

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
  if (wasIntentional) return 'intentional_stop';
  if (signal !== null) return 'process_terminated_with_signal';
  if (code === 0) return 'process_exited_with_success';
  return 'process_terminated_unexpectedly';
}
