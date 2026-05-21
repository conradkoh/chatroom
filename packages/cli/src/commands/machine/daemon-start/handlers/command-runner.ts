/**
 * Command Runner — handles command.run and command.stop events from the daemon event stream.
 *
 * Spawns child processes, captures stdout/stderr, buffers output, and flushes
 * to the backend every few seconds to minimize DB writes.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';

import { api } from '../../../../api.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import type { DaemonContext, SessionId } from '../types.js';
import { formatTimestamp } from '../utils.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Tracked running process. */
interface RunningProcess {
  process: ChildProcess;
  runId: string;
  /** Composite key: `${machineId}|${workingDir}|${commandName}` */
  commandKey: string;
  outputBuffer: string;
  chunkIndex: number;
  flushTimer: ReturnType<typeof setInterval>;
  softTimeoutTimer: ReturnType<typeof setTimeout> | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

/**
 * Primary index: runId → tracked process.
 * @internal — exported for tests only
 */
export const runningProcesses = new Map<string, RunningProcess>();

/**
 * Secondary index: commandKey → runId.
 * Allows O(1) lookup of the current process for a (machineId, workingDir, commandName) tuple.
 * @internal — exported for tests only
 */
export const runningProcessesByCommand = new Map<string, string>();

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

/** Soft timeout for command processes (24 hours). After this, the process is killed. */
const SOFT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * How long to wait after SIGTERM before force-killing with SIGKILL (ms).
 */
const SIGTERM_GRACE_PERIOD_MS = 5_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build the composite key used for command-level process lookup.
 */
function buildCommandKey(machineId: string, workingDir: string, commandName: string): string {
  return `${machineId}|${workingDir}|${commandName}`;
}

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

/**
 * Send a signal to the entire process group of the child process.
 * Because commands are spawned with `detached: true`, the child becomes the
 * leader of a new process group. Killing via negative PID delivers the signal
 * to every member of that group (e.g. turbo task children like next dev,
 * convex dev, expo start) so none are orphaned.
 */
function killProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
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
 * Kill a tracked process with SIGTERM → wait grace period → SIGKILL.
 * Cleans up the tracked process from both maps.
 */
async function killTrackedProcess(tracked: RunningProcess): Promise<void> {
  killProcess(tracked.process, 'SIGTERM');
  const exited = await waitForExit(tracked.runId, SIGTERM_GRACE_PERIOD_MS);
  if (!exited) {
    console.log(`[${formatTimestamp()}] 🔪 Force-killing process: ${tracked.runId}`);
    killProcess(tracked.process, 'SIGKILL');
    await waitForExit(tracked.runId, 1_000);
  }
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

/**
 * Handle a command.run event: kill any prior running process for the same
 * (machineId, workingDir, commandName), then spawn the new process and
 * set up output streaming.
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
  const commandKey = buildCommandKey(ctx.machineId, workingDir, commandName);

  // Prevent double-spawning
  if (runningProcesses.has(runIdStr)) {
    console.log(`[${formatTimestamp()}] ⚠️ Command already running: ${runIdStr}`);
    return;
  }

  // Check for a pending stop that arrived before this run event.
  if (pendingStops.has(runIdStr)) {
    pendingStops.delete(runIdStr);
    console.log(
      `[${formatTimestamp()}] ⏭️ Skipping command run due to pending stop: ${commandName} (${runIdStr})`
    );
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

  // ── Replace semantics: kill any prior process for this (machineId, workingDir, commandName) ──
  const priorRunId = runningProcessesByCommand.get(commandKey);
  if (priorRunId) {
    const priorTracked = runningProcesses.get(priorRunId);
    if (priorTracked) {
      console.log(
        `[${formatTimestamp()}] 🔄 Replacing prior run ${priorRunId} with ${runIdStr} for ${commandName}`
      );
      clearInterval(priorTracked.flushTimer);
      if (priorTracked.softTimeoutTimer) clearTimeout(priorTracked.softTimeoutTimer);
      await killTrackedProcess(priorTracked);
      // Maps cleaned up by the 'exit' handler — but if not (SIGKILL silent), clean manually
      runningProcesses.delete(priorRunId);
      runningProcessesByCommand.delete(commandKey);
    }
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

  // Spawn the process with `detached: true` so the child becomes the leader of
  // a new process group. This allows killProcess() to deliver signals to the
  // entire group (including turbo-spawned grandchildren) via negative PID.
  const child = spawn('sh', ['-c', script], {
    cwd: workingDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const tracked: RunningProcess = {
    process: child,
    runId: runIdStr,
    commandKey,
    outputBuffer: '',
    chunkIndex: 0,
    flushTimer: setInterval(() => {
      flushOutput(ctx, tracked).catch(() => {});
    }, OUTPUT_FLUSH_INTERVAL_MS),
    softTimeoutTimer: null,
  };
  tracked.flushTimer.unref?.();

  // Register in both indexes before async work so replace/stop lookups work immediately
  runningProcesses.set(runIdStr, tracked);
  runningProcessesByCommand.set(commandKey, runIdStr);

  // Start 24-hour soft timeout
  const softTimeoutTimer = setTimeout(async () => {
    console.log(
      `[${formatTimestamp()}] ⏰ Command soft timeout (24h): ${commandName} (runId: ${runIdStr})`
    );
    const currentTracked = runningProcesses.get(runIdStr);
    if (!currentTracked) return;

    // Set terminationReason before killing
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'killed' as any,
        terminationReason: 'timeout-24h',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark run as killed (timeout): ${getErrorMessage(err)}`
      );
    }

    killProcess(child, 'SIGTERM');
    setTimeout(() => {
      if (!runningProcesses.has(runIdStr)) return;
      console.log(`[${formatTimestamp()}] 🔪 Force-killing timed-out process: ${runIdStr}`);
      killProcess(child, 'SIGKILL');
    }, SIGTERM_GRACE_PERIOD_MS);
  }, SOFT_TIMEOUT_MS);
  softTimeoutTimer.unref?.();
  tracked.softTimeoutTimer = softTimeoutTimer;

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
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
    runningProcesses.delete(runIdStr);
    // Only delete the command key if it still points to this run (a replace may have already updated it)
    if (runningProcessesByCommand.get(commandKey) === runIdStr) {
      runningProcessesByCommand.delete(commandKey);
    }

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
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
    runningProcesses.delete(runIdStr);
    if (runningProcessesByCommand.get(commandKey) === runIdStr) {
      runningProcessesByCommand.delete(commandKey);
    }

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
 * Handle a command.stop event: kill the running process.
 */
export async function onCommandStop(ctx: DaemonContext, event: { runId: any }): Promise<void> {
  const runIdStr = event.runId.toString();
  const tracked = runningProcesses.get(runIdStr);

  // No tracked process — register pending stop and mark backend stopped.
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

  // Clear the soft timeout since we're explicitly stopping
  if (tracked.softTimeoutTimer) {
    clearTimeout(tracked.softTimeoutTimer);
    tracked.softTimeoutTimer = null;
  }

  // Send SIGTERM and wait for graceful exit
  killProcess(tracked.process, 'SIGTERM');
  const exitedAfterSigterm = await waitForExit(runIdStr, SIGTERM_GRACE_PERIOD_MS);

  if (!exitedAfterSigterm) {
    console.log(`[${formatTimestamp()}] 🔪 Force-killing process: ${runIdStr}`);
    killProcess(tracked.process, 'SIGKILL');
    await waitForExit(runIdStr, 1_000);
  }

  // Always mark the backend record as stopped.
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
 * Flushes buffered output, sends SIGTERM to each process, waits 3 seconds
 * for graceful exit, then force-kills any survivors with SIGKILL.
 * Marks each run as `status='killed'` with `terminationReason='daemon-shutdown'`.
 * No-op if no commands are running.
 */
export async function shutdownAllCommands(ctx: DaemonContext): Promise<void> {
  if (runningProcesses.size === 0) return;

  console.log(
    `[${formatTimestamp()}] Shutting down ${runningProcesses.size} running command(s)...`
  );

  // Snapshot the current runs before async work
  const trackedEntries = [...runningProcesses.entries()];

  for (const [, tracked] of trackedEntries) {
    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);

    // Best-effort flush — don't block shutdown
    await flushOutput(ctx, tracked).catch(() => {});

    // Mark run as killed in backend (best-effort)
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: tracked.runId as any,
        status: 'killed' as any,
        terminationReason: 'daemon-shutdown',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark run as killed on shutdown: ${getErrorMessage(err)}`
      );
    }

    // SIGTERM the process
    killProcess(tracked.process, 'SIGTERM');
  }

  // Grace period — give processes time to exit cleanly
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3_000);
    t.unref?.();
  });

  // Force-kill any survivors
  for (const [, tracked] of trackedEntries) {
    if (runningProcesses.has(tracked.runId)) {
      killProcess(tracked.process, 'SIGKILL');
    }
  }

  runningProcesses.clear();
  runningProcessesByCommand.clear();
  console.log(`[${formatTimestamp()}] All commands stopped`);
}
