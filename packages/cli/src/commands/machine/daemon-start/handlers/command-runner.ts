/**
 * Command Runner — handles command.run and command.stop events from the daemon event stream.
 *
 * Spawns child processes, captures stdout/stderr, buffers output, and flushes
 * to the backend every few seconds to minimize DB writes.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';

import type { DaemonContext, SessionId } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { api } from '../../../../api.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Tracked running process. */
interface RunningProcess {
  process: ChildProcess;
  runId: string;
  outputBuffer: string;
  chunkIndex: number;
  flushTimer: ReturnType<typeof setInterval>;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

// @internal — exported for tests only
export const runningProcesses = new Map<string, RunningProcess>();

/** Map of runId → timestamp for stops that arrived before the process was spawned.
 *  Used to prevent zombie processes when command.stop arrives before command.run. */
// @internal — exported for tests only
export const pendingStops = new Map<string, number>();

/** How long to keep pending stop entries before eviction (ms). */
const PENDING_STOP_TTL_MS = 60_000;

/** Evict pending stop entries older than PENDING_STOP_TTL_MS. Called periodically from the command loop. */
export function evictStalePendingStops(): void {
  const evictBefore = Date.now() - PENDING_STOP_TTL_MS;
  for (const [runId, ts] of pendingStops) {
    if (ts < evictBefore) pendingStops.delete(runId);
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** How often to flush buffered output to backend (ms). */
const OUTPUT_FLUSH_INTERVAL_MS = 3_000;

/** Maximum buffer size before forcing a flush (100KB). */
const MAX_BUFFER_SIZE = 100 * 1024;

/** Default timeout for command processes (30 minutes). After this, the process is killed. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How long to wait after SIGTERM before force-killing with SIGKILL (ms).
 * Applies to both explicit stops (command.stop event) and the 30-min watchdog.
 */
const SIGTERM_GRACE_PERIOD_MS = 5_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Report a run as failed to the backend. Used when validation fails before spawn.
 */
async function reportRunFailed(ctx: DaemonContext, runId: any, reason: string): Promise<void> {
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
      status: 'failed' as any,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to report run failure (${reason}): ${getErrorMessage(err)}`
    );
  }
}

/**
 * Flush buffered output to the backend.
 * Resets the buffer after a successful flush.
 */
async function flushOutput(ctx: DaemonContext, tracked: RunningProcess): Promise<void> {
  if (tracked.outputBuffer.length === 0) return;

  const content = tracked.outputBuffer;
  tracked.outputBuffer = '';
  const chunkIndex = tracked.chunkIndex++;

  try {
    await ctx.deps.backend.mutation(api.commands.appendOutput, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId: tracked.runId as any,
      content,
      chunkIndex,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to flush output for run ${tracked.runId}: ${getErrorMessage(err)}`
    );
    // Re-append to buffer so it's not lost
    tracked.outputBuffer = content + tracked.outputBuffer;
  }
}

/**
 * Append data to the output buffer. If buffer exceeds max size, force a flush.
 */
function appendToBuffer(ctx: DaemonContext, tracked: RunningProcess, data: string): void {
  tracked.outputBuffer += data;

  if (tracked.outputBuffer.length >= MAX_BUFFER_SIZE) {
    // Fire-and-forget flush — don't block the data stream
    flushOutput(ctx, tracked).catch(() => {});
  }
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Handle a command.run event: spawn the process and set up output streaming.
 */
export async function onCommandRun(
  ctx: DaemonContext,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  }
): Promise<void> {
  const { workingDir, commandName, script, runId } = event;
  const runIdStr = runId.toString();

  // Prevent double-spawning
  if (runningProcesses.has(runIdStr)) {
    console.log(`[${formatTimestamp()}] ⚠️ Command already running: ${runIdStr}`);
    return;
  }

  // Check for a pending stop that arrived before this run event.
  // If a stop was already received, skip spawning — the run is already marked
  // as 'stopped' in the backend, and spawning would create a zombie process.
  if (pendingStops.has(runIdStr)) {
    pendingStops.delete(runIdStr);
    console.log(
      `[${formatTimestamp()}] ⏭️ Skipping command run due to pending stop: ${commandName} (${runIdStr})`
    );
    // Backend should already be in 'stopped' state from onCommandStop, but ensure it
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'stopped' as any,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update status to stopped for pending-stop skip: ${getErrorMessage(err)}`
      );
    }
    return;
  }

  console.log(`[${formatTimestamp()}] 🚀 Running command: ${commandName} → ${script}`);

  // Security: Validate working directory exists and is an absolute path
  if (!workingDir.startsWith('/')) {
    console.error(
      `[${formatTimestamp()}] ❌ Rejected command: workingDir is not absolute: ${workingDir}`
    );
    await reportRunFailed(ctx, runId, 'Working directory is not an absolute path');
    return;
  }
  try {
    await access(workingDir);
  } catch {
    console.error(
      `[${formatTimestamp()}] ❌ Rejected command: workingDir not found: ${workingDir}`
    );
    await reportRunFailed(ctx, runId, 'Working directory not found');
    return;
  }

  // Spawn the process using a new process group so we can kill the entire tree
  const child = spawn('sh', ['-c', script], {
    cwd: workingDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // Creates a new process group
  });

  // Start a watchdog timer that kills the process if it runs too long
  const timeoutTimer = setTimeout(() => {
    console.log(
      `[${formatTimestamp()}] ⏰ Command timed out after ${DEFAULT_COMMAND_TIMEOUT_MS / 60_000} minutes: ${commandName} (runId: ${runIdStr})`
    );
    // Kill the process group (negative PID) to ensure all child processes are terminated
    const pid = child.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    } else {
      child.kill('SIGTERM');
    }
    // Force-kill after delay if still alive
    setTimeout(() => {
      if (!runningProcesses.has(runIdStr)) return;
      console.log(`[${formatTimestamp()}] 🔪 Force-killing timed-out process: ${runIdStr}`);
      if (pid) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
    }, SIGTERM_GRACE_PERIOD_MS);
  }, DEFAULT_COMMAND_TIMEOUT_MS);
  timeoutTimer.unref?.();

  const tracked: RunningProcess = {
    process: child,
    runId: runIdStr,
    outputBuffer: '',
    chunkIndex: 0,
    flushTimer: setInterval(() => {
      flushOutput(ctx, tracked).catch(() => {});
    }, OUTPUT_FLUSH_INTERVAL_MS),
    timeoutTimer,
  };

  // Unref the timer so it doesn't keep the process alive
  tracked.flushTimer.unref?.();

  runningProcesses.set(runIdStr, tracked);

  // Update status to running with PID
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
      status: 'running',
      pid: child.pid,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to update run status to running: ${getErrorMessage(err)}`
    );
  }

  // Capture stdout
  child.stdout?.on('data', (data: Buffer) => {
    appendToBuffer(ctx, tracked, data.toString());
  });

  // Capture stderr
  child.stderr?.on('data', (data: Buffer) => {
    appendToBuffer(ctx, tracked, data.toString());
  });

  // Handle process exit
  child.on('exit', async (code, signal) => {
    console.log(
      `[${formatTimestamp()}] 🏁 Command exited: ${commandName} (code=${code}, signal=${signal})`
    );

    // Flush remaining output
    await flushOutput(ctx, tracked).catch(() => {});

    // Clean up timers and state
    clearInterval(tracked.flushTimer);
    if (tracked.timeoutTimer) clearTimeout(tracked.timeoutTimer);
    runningProcesses.delete(runIdStr);

    // Determine final status
    const status = code === 0 ? 'completed' : signal ? 'stopped' : 'failed';

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: status as any,
        exitCode: code ?? undefined,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update run status on exit: ${getErrorMessage(err)}`
      );
    }
  });

  // Handle spawn error
  child.on('error', async (err) => {
    console.error(`[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`);

    clearInterval(tracked.flushTimer);
    if (tracked.timeoutTimer) clearTimeout(tracked.timeoutTimer);
    runningProcesses.delete(runIdStr);

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'failed' as any,
      });
    } catch (updateErr) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update run status on error: ${getErrorMessage(updateErr)}`
      );
    }
  });
}

/**
 * Send a signal to a process group (negative PID), falling back to the child directly.
 */
function killProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Process group may already be dead; fall through to direct kill
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already dead
  }
}

/**
 * Wait up to `ms` milliseconds for the process to exit (i.e. be removed from runningProcesses).
 * Resolves true if the process exited within the timeout, false otherwise.
 */
function waitForExit(runIdStr: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const interval = 100;
    let elapsed = 0;
    const timer = setInterval(() => {
      if (!runningProcesses.has(runIdStr)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      elapsed += interval;
      if (elapsed >= ms) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });
}

/**
 * Handle a command.stop event: kill the running process.
 *
 * Stop logic:
 * 1. Check if a tracked process exists for this runId.
 * 2. If not, register a pending stop and mark the backend record as stopped.
 * 3. If yes, send SIGTERM and wait up to 10s for the process to exit.
 * 4. If still running after 10s, send SIGKILL.
 * 5. If still running after SIGKILL, log a stop failure.
 * 6. In all cases, mark the backend record as stopped.
 */
export async function onCommandStop(ctx: DaemonContext, event: { runId: any }): Promise<void> {
  const runIdStr = event.runId.toString();
  const tracked = runningProcesses.get(runIdStr);

  // Step 1 & 2: No tracked process — register pending stop and mark backend stopped.
  if (!tracked) {
    console.log(
      `[${formatTimestamp()}] ⚠️ No running process found for run: ${runIdStr} — marking as stopped`
    );
    pendingStops.set(runIdStr, Date.now());
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: event.runId,
        status: 'stopped' as any,
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark run as stopped (will retry): ${getErrorMessage(err)}`
      );
      throw err;
    }
    return;
  }

  console.log(`[${formatTimestamp()}] 🛑 Stopping command run: ${runIdStr}`);

  // Clear the timeout watchdog since we're explicitly stopping
  if (tracked.timeoutTimer) {
    clearTimeout(tracked.timeoutTimer);
    tracked.timeoutTimer = null;
  }

  // Step 3: Send SIGTERM and wait up to 10s for graceful exit.
  killProcess(tracked.process, 'SIGTERM');
  const exitedAfterSigterm = await waitForExit(runIdStr, SIGTERM_GRACE_PERIOD_MS);

  if (!exitedAfterSigterm) {
    // Step 4: Still running — send SIGKILL.
    console.log(`[${formatTimestamp()}] 🔪 Force-killing process: ${runIdStr}`);
    killProcess(tracked.process, 'SIGKILL');

    // Give SIGKILL a moment to take effect (kernel-level, should be near-instant)
    const exitedAfterSigkill = await waitForExit(runIdStr, 1_000);

    if (!exitedAfterSigkill) {
      // Step 5: Still alive after SIGKILL — log failure.
      console.error(
        `[${formatTimestamp()}] ❌ Failed to stop process for run: ${runIdStr} — process did not exit after SIGKILL`
      );
    }
  }

  // Step 6: Always mark the backend record as stopped.
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId: event.runId,
      status: 'stopped' as any,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to mark run as stopped in backend: ${getErrorMessage(err)}`
    );
  }
}

/**
 * Kill all currently running command processes during daemon shutdown.
 *
 * Flushes buffered output, sends SIGTERM to each process group, waits 3 seconds
 * for graceful exit, then force-kills any survivors with SIGKILL.
 * No-op if no commands are running.
 */
export async function shutdownAllCommands(ctx: DaemonContext): Promise<void> {
  if (runningProcesses.size === 0) return;

  console.log(
    `[${formatTimestamp()}] Shutting down ${runningProcesses.size} running command(s)...`
  );

  for (const [, tracked] of runningProcesses) {
    clearInterval(tracked.flushTimer);
    if (tracked.timeoutTimer) clearTimeout(tracked.timeoutTimer);

    // Best-effort flush — don't block shutdown
    await flushOutput(ctx, tracked).catch(() => {});

    // SIGTERM the process group so all child processes are terminated
    const pid = tracked.process.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        tracked.process.kill('SIGTERM');
      }
    } else {
      tracked.process.kill('SIGTERM');
    }
  }

  // Grace period — give processes time to exit cleanly before force-killing
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3_000);
    t.unref?.();
  });

  // Force-kill any survivors
  for (const [, tracked] of runningProcesses) {
    const pid = tracked.process.pid;
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already dead */
      }
    } else {
      try {
        tracked.process.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
  }

  runningProcesses.clear();
  console.log(`[${formatTimestamp()}] All commands stopped`);
}
