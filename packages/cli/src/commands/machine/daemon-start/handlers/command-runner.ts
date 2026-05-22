/**
 * Command Runner — handles command.run and command.stop events from the daemon event stream.
 *
 * Spawns child processes, captures stdout/stderr, buffers output, and flushes
 * to the backend every few seconds to minimize DB writes.
 */

import { access } from 'node:fs/promises';

import { api } from '../../../../api.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import type { DaemonContext, SessionId } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { clearTrackedPids } from './orphan-tracker.js';
import { TERMINAL_STATES } from './process/state.js';
import { processManager } from './process/manager.js';
import { spawnCommandProcess } from './process/spawner.js';
import { killProcess, killTrackedProcess } from './process/killer.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildCommandKey(machineId: string, workingDir: string, commandName: string): string {
  return `${machineId}|${workingDir}|${commandName}`;
}

async function reportRunFailed(ctx: DaemonContext, runId: any, reason: string): Promise<void> {
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
      status: 'failed',
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to report run failure (${reason}): ${getErrorMessage(err)}`
    );
  }
}

// ─── Event Handlers ─────────────────────────────────────────────────────────

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
  if (processManager.has(runIdStr)) {
    console.log(`[${formatTimestamp()}] ⚠️ Command already running: ${runIdStr}`);
    return;
  }

  // Check for a pending stop that arrived before this run event.
  if (processManager.consumePendingStop(runIdStr)) {
    console.log(
      `[${formatTimestamp()}] ⏭️ Skipping command run due to pending stop: ${commandName} (${runIdStr})`
    );
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId,
        status: 'stopped',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to update status to stopped for pending-stop skip: ${getErrorMessage(err)}`
      );
    }
    return;
  }

  // ── Pre-spawn DB status check ──────────────────────────────────────────────
  try {
    const currentRun = (await ctx.deps.backend.query(api.commands.getRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
    })) as { status: string } | null;
    if (currentRun && TERMINAL_STATES.has(currentRun.status)) {
      console.log(
        `[${formatTimestamp()}] ⏭️ Skipping command run — row already ${currentRun.status}: ${commandName} (${runIdStr})`
      );
      return;
    }
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to check run status before spawn: ${getErrorMessage(err)}`
    );
  }

  // ── Replace semantics: kill any prior process for this (machineId, workingDir, commandName) ──
  const priorTracked = processManager.getByCommand(commandKey);
  if (priorTracked) {
    console.log(
      `[${formatTimestamp()}] 🔄 Replacing prior run ${priorTracked.runId} with ${runIdStr} for ${commandName}`
    );
    priorTracked.terminationIntent = 'killed';
    clearInterval(priorTracked.flushTimer);
    if (priorTracked.softTimeoutTimer) clearTimeout(priorTracked.softTimeoutTimer);
    await killTrackedProcess(priorTracked);
    processManager.unregister(priorTracked.runId, commandKey);
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

  // Delegate spawning, output streaming, event handler attachment to spawner
  const tracked = spawnCommandProcess(ctx, event, commandKey);

  // Update status to running with PID
  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId,
      status: 'running',
      pid: tracked.process.pid,
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to update run status to running: ${getErrorMessage(err)}`
    );
  }
}

export async function onCommandStop(ctx: DaemonContext, event: { runId: any }): Promise<void> {
  const runIdStr = event.runId.toString();
  const tracked = processManager.get(runIdStr);

  // No tracked process — register pending stop and mark backend stopped.
  if (!tracked) {
    console.log(
      `[${formatTimestamp()}] ⚠️ No running process found for run: ${runIdStr} — marking as stopped`
    );
    processManager.markPendingStop(runIdStr);
    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: event.runId,
        status: 'stopped',
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

  if (tracked.softTimeoutTimer) {
    clearTimeout(tracked.softTimeoutTimer);
    tracked.softTimeoutTimer = null;
  }

  tracked.terminationIntent = 'stopped';
  await killTrackedProcess(tracked);

  try {
    await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
      runId: event.runId,
      status: 'stopped',
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to mark run as stopped in backend: ${getErrorMessage(err)}`
    );
  }
}

export async function shutdownAllCommands(ctx: DaemonContext): Promise<void> {
  if (processManager.size === 0) return;

  console.log(`[${formatTimestamp()}] Shutting down ${processManager.size} running command(s)...`);

  const trackedEntries = processManager.getAll();

  for (const [, tracked] of trackedEntries) {
    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);

    try {
      await ctx.deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
        runId: tracked.runId as any,
        status: 'killed',
        terminationReason: 'daemon-shutdown',
      });
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Failed to mark run as killed on shutdown: ${getErrorMessage(err)}`
      );
    }

    killProcess(tracked.process, 'SIGTERM');
  }

  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 3_000);
    t.unref?.();
  });

  for (const [, tracked] of trackedEntries) {
    if (processManager.has(tracked.runId)) {
      killProcess(tracked.process, 'SIGKILL');
    }
  }

  processManager.clear();
  clearTrackedPids();
  console.log(`[${formatTimestamp()}] All commands stopped`);
}
