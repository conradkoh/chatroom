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
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Map of runId → RunningProcess for active processes. */
const runningProcesses = new Map<string, RunningProcess>();

// ─── Constants ──────────────────────────────────────────────────────────────

/** How often to flush buffered output to backend (ms). */
const OUTPUT_FLUSH_INTERVAL_MS = 3_000;

/** Maximum buffer size before forcing a flush (100KB). */
const MAX_BUFFER_SIZE = 100 * 1024;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Report a run as failed to the backend. Used when validation fails before spawn.
 */
async function reportRunFailed(
  ctx: DaemonContext,
  runId: any,
  reason: string
): Promise<void> {
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
async function flushOutput(
  ctx: DaemonContext,
  tracked: RunningProcess
): Promise<void> {
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
function appendToBuffer(
  ctx: DaemonContext,
  tracked: RunningProcess,
  data: string
): void {
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

  console.log(`[${formatTimestamp()}] 🚀 Running command: ${commandName} → ${script}`);

  // Security: Validate working directory exists and is an absolute path
  if (!workingDir.startsWith('/')) {
    console.error(`[${formatTimestamp()}] ❌ Rejected command: workingDir is not absolute: ${workingDir}`);
    await reportRunFailed(ctx, runId, 'Working directory is not an absolute path');
    return;
  }
  try {
    await access(workingDir);
  } catch {
    console.error(`[${formatTimestamp()}] ❌ Rejected command: workingDir not found: ${workingDir}`);
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

  const tracked: RunningProcess = {
    process: child,
    runId: runIdStr,
    outputBuffer: '',
    chunkIndex: 0,
    flushTimer: setInterval(() => {
      flushOutput(ctx, tracked).catch(() => {});
    }, OUTPUT_FLUSH_INTERVAL_MS),
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

    // Clean up
    clearInterval(tracked.flushTimer);
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
    console.error(
      `[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`
    );

    clearInterval(tracked.flushTimer);
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
 * Handle a command.stop event: kill the running process.
 */
export async function onCommandStop(
  ctx: DaemonContext,
  event: { runId: any }
): Promise<void> {
  const runIdStr = event.runId.toString();
  const tracked = runningProcesses.get(runIdStr);

  if (!tracked) {
    console.log(`[${formatTimestamp()}] ⚠️ No running process found for run: ${runIdStr}`);
    // Process not tracked locally (e.g., daemon restarted). Update status to 'stopped'
    // so the UI doesn't show it as running forever.
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: event.runId,
        status: 'stopped' as any,
      });
      console.log(`[${formatTimestamp()}] 📝 Marked orphaned run as stopped: ${runIdStr}`);
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark orphaned run as stopped: ${getErrorMessage(err)}`
      );
    }
    return;
  }

  console.log(`[${formatTimestamp()}] 🛑 Stopping command run: ${runIdStr}`);

  // Kill the entire process group (negative PID) to ensure all child processes are terminated
  const pid = tracked.process.pid;
  if (pid) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Process group may already be dead
      tracked.process.kill('SIGTERM');
    }
  } else {
    tracked.process.kill('SIGTERM');
  }

  setTimeout(() => {
    if (tracked.process.killed) return;
    console.log(`[${formatTimestamp()}] 🔪 Force-killing process: ${runIdStr}`);
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        tracked.process.kill('SIGKILL');
      }
    } else {
      tracked.process.kill('SIGKILL');
    }
  }, 5_000);
}
