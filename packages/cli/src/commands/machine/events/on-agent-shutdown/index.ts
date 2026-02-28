import type { DaemonContext } from '../../daemon-start/types.js';

export interface OnAgentShutdownOptions {
  chatroomId: string;
  role: string;
  pid: number;
  /** If true, skip the kill step (process already dead) */
  skipKill?: boolean;
}

export interface OnAgentShutdownResult {
  killed: boolean;
  cleaned: boolean;
}

/**
 * Handle a single agent's shutdown: kill process and clear local state.
 * Backend cleanup (PID clearing, participant removal, crash recovery scheduling)
 * is handled by the `agent:exited` event listener via `recordAgentExited`.
 * All steps are best-effort — errors are logged, never thrown.
 *
 * Responsibilities:
 * 1. Mark intentional stop (before killing) to prevent crash-detection race conditions
 * 2. Kill the process with verified shutdown (SIGTERM → wait → SIGKILL)
 * 3. Clear local PID state
 *
 * Key invariants:
 * - PID (local) is cleared ONLY after the process is confirmed dead
 * - All external calls are wrapped in try/catch so no exception propagates
 * - stops.mark is called BEFORE kill to prevent crash-detection race conditions
 */
export async function onAgentShutdown(
  ctx: DaemonContext,
  options: OnAgentShutdownOptions
): Promise<OnAgentShutdownResult> {
  const { chatroomId, role, pid, skipKill } = options;

  // Step 1: Mark as intentional stop BEFORE killing — prevents race condition where
  // the process exits before the mark, causing onExit to treat it as an unexpected crash.
  // Wrapped in try/catch: if marking fails we still want to proceed with the kill.
  try {
    ctx.deps.stops.mark(chatroomId, role);
  } catch (e) {
    console.log(`   ⚠️  Failed to mark intentional stop for ${role}: ${(e as Error).message}`);
  }

  // Step 2: Kill the process with verified shutdown
  let killed = false;
  if (!skipKill) {
    // 2a. Send SIGTERM to entire process group (negative PID)
    // Only treat ESRCH as "process already dead"; other errors (EPERM etc.) mean
    // the kill failed but the process may still be running.
    try {
      ctx.deps.processes.kill(-pid, 'SIGTERM');
    } catch (e) {
      const isEsrch =
        (e as NodeJS.ErrnoException).code === 'ESRCH' || (e as Error).message?.includes('ESRCH');
      if (isEsrch) {
        killed = true; // Process already dead
      }
      // Non-ESRCH errors (e.g. EPERM): log and continue to polling loop
      if (!isEsrch) {
        console.log(`   ⚠️  Failed to send SIGTERM to ${role}: ${(e as Error).message}`);
      }
    }

    if (!killed) {
      // 2b. Wait up to 10s for graceful exit (check parent via positive PID)
      const SIGTERM_TIMEOUT_MS = 10_000;
      const POLL_INTERVAL_MS = 500;
      const deadline = Date.now() + SIGTERM_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await ctx.deps.clock.delay(POLL_INTERVAL_MS);
        try {
          ctx.deps.processes.kill(pid, 0);
        } catch {
          // Any exception on signal=0 means process is gone
          killed = true;
          break;
        }
      }
    }

    // 2c. If still alive after SIGTERM timeout, SIGKILL entire process group
    if (!killed) {
      try {
        ctx.deps.processes.kill(-pid, 'SIGKILL');
      } catch {
        killed = true; // Already dead between check and kill
      }
    }

    // 2d. Final check — wait 5s and log if still alive (check parent via positive PID)
    if (!killed) {
      await ctx.deps.clock.delay(5_000);
      try {
        ctx.deps.processes.kill(pid, 0);
        console.log(`   ⚠️  Process ${pid} (${role}) still alive after SIGKILL — possible zombie`);
      } catch {
        killed = true;
      }
    }
  }

  // Step 3: Clear local PID state — ONLY if process is confirmed dead
  // Wrapped in try/catch: if local state clear fails, continue gracefully.
  if (killed || skipKill) {
    try {
      ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);
    } catch (e) {
      console.log(`   ⚠️  Failed to clear local PID for ${role}: ${(e as Error).message}`);
    }
  }

  // Backend cleanup (PID clearing, participant removal, crash recovery) is handled
  // by the agent:exited event listener via recordAgentExited — not here.

  return {
    killed: killed || (skipKill ?? false),
    cleaned: killed || (skipKill ?? false),
  };
}
