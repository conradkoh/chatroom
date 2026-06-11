/**
 * Command Runner — handles command.run and command.stop events from the daemon event stream.
 *
 * Spawns child processes, captures stdout/stderr, buffers output, and flushes
 * to the backend every few seconds to minimize DB writes.
 */

import { access } from 'node:fs/promises';

import { Effect } from 'effect';

import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import { DaemonSessionService } from '../daemon-services.js';
import type { SessionId } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { clearTrackedPids } from './orphan-tracker.js';
import { killProcess, killTrackedProcess } from './process/killer.js';
import { processManager } from './process/manager.js';
import { spawnCommandProcess } from './process/spawner.js';
import { TERMINAL_STATES } from './process/state.js';

// ─── Flat deps type ──────────────────────────────────────────────────────────

/**
 * Flat deps required by onCommandRunCore and onCommandStopCore.
 * DaemonSessionServiceShape structurally satisfies this type.
 */
export type CommandRunnerDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildCommandKey(machineId: string, workingDir: string, commandName: string): string {
  return `${machineId}|${workingDir}|${commandName}`;
}

async function reportRunFailed(deps: CommandRunnerDeps, runId: any, reason: string): Promise<void> {
  try {
    await deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      runId,
      status: 'failed',
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to report run failure (${reason}): ${getErrorMessage(err)}`
    );
  }
}

// ─── Core Event Handlers (flat deps, no ctx.deps.xxx) ───────────────────────

// fallow-ignore-next-line unused-export
export async function onCommandRunCore(
  deps: CommandRunnerDeps,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  }
): Promise<void> {
  const { workingDir, commandName, script, runId } = event;
  const runIdStr = runId.toString();
  const commandKey = buildCommandKey(deps.machineId, workingDir, commandName);

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
      await deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
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
    const currentRun = (await deps.backend.query(api.commands.getRunStatus, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
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
    await reportRunFailed(deps, runId, 'Working directory is not an absolute path');
    return;
  }
  try {
    await access(workingDir);
  } catch {
    console.error(
      `[${formatTimestamp()}] ❌ Rejected command: workingDir not found: ${workingDir}`
    );
    await reportRunFailed(deps, runId, 'Working directory not found');
    return;
  }

  // Delegate spawning, output streaming, event handler attachment to spawner.
  // Pass flat SpawnDeps (plain object, no cast) that satisfies spawner's
  // { sessionId, machineId, backend } requirement.
  const spawnDeps = {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    backend: deps.backend,
  };
  const tracked = await spawnCommandProcess(spawnDeps, event, commandKey);

  // Update status to running with PID
  try {
    await deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
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

// fallow-ignore-next-line unused-export
export async function onCommandStopCore(
  deps: CommandRunnerDeps,
  event: { runId: any }
): Promise<void> {
  const runIdStr = event.runId.toString();
  const tracked = processManager.get(runIdStr);

  // No tracked process — register pending stop and mark backend stopped.
  if (!tracked) {
    console.log(
      `[${formatTimestamp()}] ⚠️ No running process found for run: ${runIdStr} — marking as stopped`
    );
    processManager.markPendingStop(runIdStr);
    try {
      await deps.backend.mutation(api.commands.updateRunStatus, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
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
    await deps.backend.mutation(api.commands.updateRunStatus, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
      runId: event.runId,
      status: 'stopped',
    });
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to mark run as stopped in backend: ${getErrorMessage(err)}`
    );
  }
}

/**
 * Synchronously SIGKILL every in-memory tracked command process group.
 *
 * Used by the force-exit path (second Ctrl+C) where we cannot await the
 * graceful SIGTERM→grace→SIGKILL sequence. Best-effort and never throws.
 */
export function forceKillAllCommands(): void {
  for (const [, tracked] of processManager.getAll()) {
    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
    killProcess(tracked.process, 'SIGKILL');
  }
}

// ── Effect twins ──────────────────────────────────────────────────────────────

/** Effect twin for onCommandRun — yields DaemonSessionService; DaemonSessionServiceShape satisfies CommandRunnerDeps. */
export const onCommandRunEffect = (event: {
  workingDir: string;
  commandName: string;
  script: string;
  runId: any;
}): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => onCommandRunCore(session, event));
  });

/** Effect twin for onCommandStop — yields DaemonSessionService; DaemonSessionServiceShape satisfies CommandRunnerDeps. */
export const onCommandStopEffect = (event: {
  runId: any;
}): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    yield* Effect.promise(() => onCommandStopCore(session, event));
  });

/** Effect twin for forceKillAllCommands — synchronous, no service deps needed. */
// fallow-ignore-next-line unused-export
export const forceKillAllCommandsEffect: Effect.Effect<void> = Effect.sync(() =>
  forceKillAllCommands()
);

/** Effect twin for shutdownAllCommands — yields DaemonSessionService. */
export const shutdownAllCommandsEffect: Effect.Effect<void, never, DaemonSessionService> =
  Effect.gen(function* () {
    if (processManager.size === 0) return;

    const session = yield* DaemonSessionService;

    console.log(
      `[${formatTimestamp()}] Shutting down ${processManager.size} running command(s)...`
    );

    const trackedEntries = processManager.getAll();

    // Phase 1 — kill first (same logic as legacy)
    for (const [, tracked] of trackedEntries) {
      clearInterval(tracked.flushTimer);
      if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
      killProcess(tracked.process, 'SIGTERM');
    }

    // Phase 2 — best-effort backend status updates in parallel
    const statusUpdates = Promise.allSettled(
      trackedEntries.map(([, tracked]) =>
        session.backend
          .mutation(api.commands.updateRunStatus, {
            sessionId: session.sessionId as SessionId,
            machineId: session.machineId,
            runId: tracked.runId as any,
            status: 'killed',
            terminationReason: 'daemon-shutdown',
          })
          .catch((err) => {
            console.warn(
              `[${formatTimestamp()}] ⚠️ Failed to mark run as killed on shutdown: ${getErrorMessage(err)}`
            );
          })
      )
    );

    // Phase 3 — grace period (3s), then SIGKILL survivors
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3_000);
          t.unref?.();
        })
    );

    for (const [, tracked] of trackedEntries) {
      if (processManager.has(tracked.runId)) {
        killProcess(tracked.process, 'SIGKILL');
      }
    }

    processManager.clear();
    clearTrackedPids();

    // Cap network wait to 2s
    yield* Effect.promise(() =>
      Promise.race([
        statusUpdates,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2_000);
          t.unref?.();
        }),
      ])
    );

    console.log(`[${formatTimestamp()}] All commands stopped`);
  });
