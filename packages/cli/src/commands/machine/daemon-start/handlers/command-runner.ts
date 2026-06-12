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
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import type { SessionId } from '../types.js';
import { formatTimestamp } from '../utils.js';
import { clearTrackedPids } from './orphan-tracker.js';
import { killProcess, killTrackedProcess } from './process/killer.js';
import { processManager } from './process/manager.js';
import { spawnCommandProcess } from './process/spawner.js';
import { TERMINAL_STATES } from './process/state.js';

// ─── Flat deps type ──────────────────────────────────────────────────────────

/**
 * Flat deps required by runOnCommandRun / runOnCommandStop test helpers.
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

const reportRunFailedEffect = (
  session: Pick<DaemonSessionServiceShape, 'sessionId' | 'machineId' | 'backend'>,
  runId: any,
  reason: string
): Effect.Effect<void, never, never> =>
  Effect.catchAll(
    Effect.tryPromise(() =>
      session.backend.mutation(api.commands.updateRunStatus, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        runId,
        status: 'failed',
      })
    ),
    (err) =>
      Effect.sync(() => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Failed to report run failure (${reason}): ${getErrorMessage(err)}`
        );
      })
  );

// ─── Effect Event Handlers ──────────────────────────────────────────────────

/** Effect twin for onCommandRun — yields DaemonSessionService; DaemonSessionServiceShape satisfies CommandRunnerDeps. */
export const onCommandRunEffect = (event: {
  workingDir: string;
  commandName: string;
  script: string;
  runId: any;
}): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const { workingDir, commandName, script, runId } = event;
    const runIdStr = runId.toString();
    const commandKey = buildCommandKey(session.machineId, workingDir, commandName);

    if (processManager.has(runIdStr)) {
      console.log(`[${formatTimestamp()}] ⚠️ Command already running: ${runIdStr}`);
      return;
    }

    if (processManager.consumePendingStop(runIdStr)) {
      console.log(
        `[${formatTimestamp()}] ⏭️ Skipping command run due to pending stop: ${commandName} (${runIdStr})`
      );
      yield* Effect.catchAll(
        Effect.tryPromise(() =>
          session.backend.mutation(api.commands.updateRunStatus, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            runId,
            status: 'stopped',
          })
        ),
        (err) =>
          Effect.sync(() => {
            console.warn(
              `[${formatTimestamp()}] ⚠️ Failed to update status to stopped for pending-stop skip: ${getErrorMessage(err)}`
            );
          })
      );
      return;
    }

    const isTerminal = yield* Effect.catchAll(
      Effect.tryPromise(() =>
        session.backend.query(api.commands.getRunStatus, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          runId,
        })
      ).pipe(
        Effect.map((currentRun: { status: string } | null) => {
          if (currentRun && TERMINAL_STATES.has(currentRun.status)) {
            console.log(
              `[${formatTimestamp()}] ⏭️ Skipping command run — row already ${currentRun.status}: ${commandName} (${runIdStr})`
            );
            return true;
          }
          return false;
        })
      ),
      (err) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Failed to check run status before spawn: ${getErrorMessage(err)}`
        );
        return Effect.succeed(false);
      }
    );
    if (isTerminal) return;

    const priorTracked = processManager.getByCommand(commandKey);
    if (priorTracked) {
      console.log(
        `[${formatTimestamp()}] 🔄 Replacing prior run ${priorTracked.runId} with ${runIdStr} for ${commandName}`
      );
      priorTracked.terminationIntent = 'killed';
      clearInterval(priorTracked.flushTimer);
      if (priorTracked.softTimeoutTimer) clearTimeout(priorTracked.softTimeoutTimer);
      yield* Effect.promise(() => killTrackedProcess(priorTracked));
      processManager.unregister(priorTracked.runId, commandKey);
    }

    console.log(`[${formatTimestamp()}] 🚀 Running command: ${commandName} → ${script}`);

    if (!workingDir.startsWith('/')) {
      console.error(
        `[${formatTimestamp()}] ❌ Rejected command: workingDir is not absolute: ${workingDir}`
      );
      yield* reportRunFailedEffect(session, runId, 'Working directory is not an absolute path');
      return;
    }

    const dirFound = yield* Effect.catchAll(
      Effect.tryPromise(() => access(workingDir)).pipe(Effect.map(() => true)),
      () => Effect.succeed(false)
    );
    if (!dirFound) {
      console.error(
        `[${formatTimestamp()}] ❌ Rejected command: workingDir not found: ${workingDir}`
      );
      yield* reportRunFailedEffect(session, runId, 'Working directory not found');
      return;
    }

    const spawnDeps = {
      sessionId: session.sessionId,
      machineId: session.machineId,
      backend: session.backend,
    };
    const tracked = yield* Effect.promise(() => spawnCommandProcess(spawnDeps, event, commandKey));

    yield* Effect.catchAll(
      Effect.tryPromise(() =>
        session.backend.mutation(api.commands.updateRunStatus, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          runId,
          status: 'running',
          pid: tracked.process.pid,
        })
      ),
      (err) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Failed to update run status to running: ${getErrorMessage(err)}`
          );
        })
    );
  });

/** Effect twin for onCommandStop — yields DaemonSessionService; DaemonSessionServiceShape satisfies CommandRunnerDeps. */
export const onCommandStopEffect = (event: {
  runId: any;
}): Effect.Effect<void, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const runIdStr = event.runId.toString();
    const tracked = processManager.get(runIdStr);

    if (!tracked) {
      console.log(
        `[${formatTimestamp()}] ⚠️ No running process found for run: ${runIdStr} — marking as stopped`
      );
      processManager.markPendingStop(runIdStr);
      yield* Effect.promise(() =>
        session.backend.mutation(api.commands.updateRunStatus, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          runId: event.runId,
          status: 'stopped',
        })
      );
      return;
    }

    console.log(`[${formatTimestamp()}] 🛑 Stopping command run: ${runIdStr}`);

    if (tracked.softTimeoutTimer) {
      clearTimeout(tracked.softTimeoutTimer);
      tracked.softTimeoutTimer = null;
    }

    tracked.terminationIntent = 'stopped';
    yield* Effect.promise(() => killTrackedProcess(tracked));

    yield* Effect.catchAll(
      Effect.tryPromise(() =>
        session.backend.mutation(api.commands.updateRunStatus, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          runId: event.runId,
          status: 'stopped',
        })
      ),
      (err) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Failed to mark run as stopped in backend: ${getErrorMessage(err)}`
          );
        })
    );
  });

/** Test helper — run onCommandRunEffect with flat deps (not a Core twin). */
// fallow-ignore-next-line unused-export
export const runOnCommandRun = (
  deps: CommandRunnerDeps,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  }
): Promise<void> =>
  Effect.runPromise(
    onCommandRunEffect(event).pipe(
      Effect.provideService(DaemonSessionService, deps as DaemonSessionServiceShape)
    )
  );

/** Test helper — run onCommandStopEffect with flat deps (not a Core twin). */
// fallow-ignore-next-line unused-export
export const runOnCommandStop = (deps: CommandRunnerDeps, event: { runId: any }): Promise<void> =>
  Effect.runPromise(
    onCommandStopEffect(event).pipe(
      Effect.provideService(DaemonSessionService, deps as DaemonSessionServiceShape)
    )
  );

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
