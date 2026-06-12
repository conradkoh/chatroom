import { spawn } from 'node:child_process';

import { encodeOutput } from '@workspace/backend/src/output-encoding.js';
import { Effect } from 'effect';

import { killProcess } from './killer.js';
import { consumePendingFullSync, isRunLogObserved } from './log-observer-sync.js';
import { processManager } from './manager.js';
import { createOutputStore, ensureTempDir, MAX_TAIL_LINES_V2 } from './output-store.js';
import {
  OUTPUT_FLUSH_INTERVAL_MS,
  MAX_BUFFER_SIZE,
  SOFT_TIMEOUT_MS,
  SIGTERM_GRACE_PERIOD_MS,
  deriveTerminalStatus,
  type RunningProcess,
} from './state.js';
import { api } from '../../../../../api.js';
import type { BackendOps } from '../../../../../infrastructure/deps/index.js';
import type { SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';
import { trackChildPid, untrackChildPid } from '../orphan-tracker.js';

let tempDirReady = false;

/**
 * Minimal structural type accepted by all functions in spawner.ts.
 * DaemonContext structurally satisfies this type, so all old call sites continue
 * to work without modification. New Effect-based callers pass a plain object.
 */
/** Flat deps for spawner — no deps.deps indirection. */
export type SpawnDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
};

/** Effect twin — flush tail output to backend. */
const flushTailV2Effect = (
  deps: SpawnDeps,
  tracked: RunningProcess,
  force = false
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (!force && !isRunLogObserved(tracked.runId)) return;

    const tail = yield* Effect.tryPromise({
      try: () => tracked.store.getLastNLines(MAX_TAIL_LINES_V2),
      catch: (e) => e,
    }).pipe(
      Effect.catchAll(
        (): Effect.Effect<{ content: string; totalBytes: number; lineCount: number }, never> =>
          Effect.succeed({ content: '', totalBytes: 0, lineCount: 0 })
      )
    );
    if (tail.content.length === 0) return;

    const compressed = encodeOutput(tail.content);
    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.commands.updateRunTailV2, {
          sessionId: deps.sessionId as SessionId,
          machineId: deps.machineId,
          runId: tracked.runId as any,
          tailOutput: {
            compression: compressed.compression,
            content: compressed.content,
            byteLength: tail.totalBytes,
            totalBytesWritten: tail.totalBytes,
            updatedAt: Date.now(),
            lineCount: tail.lineCount,
          },
        }),
      catch: (e) => e,
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Failed to flush tail for run ${tracked.runId}:`,
            err instanceof Error ? err.message : String(err)
          );
        })
      )
    );
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function flushTailV2(deps: SpawnDeps, tracked: RunningProcess, force = false): Promise<void> {
  return Effect.runPromise(flushTailV2Effect(deps, tracked, force));
}

/** Effect twin — append full output in chunks to backend. */
const appendFullOutputChunksEffect = (
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const fullOutput = yield* Effect.catchAll(
      Effect.tryPromise({
        try: () => tracked.store.getFullOutput(),
        catch: (e) => e,
      }),
      (err) =>
        Effect.sync(() => {
          console.error(
            `[${formatTimestamp()}] ❌ Failed to read temp file for run ${tracked.runId}:`,
            err instanceof Error ? err.message : String(err)
          );
          return tracked.store.getTail().content;
        })
    );

    if (fullOutput.length === 0) return;

    let chunkIndex = 0;
    for (let i = 0; i < fullOutput.length; i += MAX_BUFFER_SIZE) {
      const slice = fullOutput.slice(i, i + MAX_BUFFER_SIZE);
      const compressed = encodeOutput(slice);
      const flushed = yield* Effect.catchAll(
        Effect.tryPromise({
          try: () =>
            deps.backend.mutation(api.commands.appendOutput, {
              sessionId: deps.sessionId as SessionId,
              machineId: deps.machineId,
              runId,
              content: compressed,
              chunkIndex,
            }),
          catch: (e) => e,
        }),
        (err) =>
          Effect.sync(() => {
            console.error(
              `[${formatTimestamp()}] ❌ Failed to flush chunk ${chunkIndex} for run ${tracked.runId}:`,
              err instanceof Error ? err.message : String(err)
            );
            return false as const;
          })
      );
      if (flushed === false) return;
      chunkIndex++;
    }
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function appendFullOutputChunks(
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
  return Effect.runPromise(appendFullOutputChunksEffect(deps, tracked, runId));
}

/** Effect twin — final tail flush + optional full output sync. */
const flushFinalChunksEffect = (
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* flushTailV2Effect(deps, tracked, true);
    if (consumePendingFullSync(tracked.runId)) {
      yield* appendFullOutputChunksEffect(deps, tracked, runId);
    }
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function flushFinalChunks(
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
  return Effect.runPromise(flushFinalChunksEffect(deps, tracked, runId));
}

/** Effect twin — one-shot full log sync on webapp request. */
// fallow-ignore-next-line unused-export
export const syncFullOutputOnRequestEffect = (
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    if (!consumePendingFullSync(tracked.runId)) return;

    yield* appendFullOutputChunksEffect(deps, tracked, runId);

    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.commands.clearPendingFullOutputSync, {
          sessionId: deps.sessionId as SessionId,
          machineId: deps.machineId,
          runId,
        }),
      catch: (e) => e,
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Failed to clear pending full sync for ${tracked.runId}:`,
            err instanceof Error ? err.message : String(err)
          );
        })
      )
    );
  });

// fallow-ignore-next-line unused-export
export async function syncFullOutputOnRequest(
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any
): Promise<void> {
  return Effect.runPromise(syncFullOutputOnRequestEffect(deps, tracked, runId));
}

/** Effect twin — poll all running processes for pending full output syncs. */
// fallow-ignore-next-line unused-export
export const pollPendingFullOutputSyncsEffect = (
  deps: SpawnDeps
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    for (const [runId, tracked] of processManager.getAll()) {
      if (consumePendingFullSync(runId)) {
        yield* syncFullOutputOnRequestEffect(deps, tracked, runId as any);
      }
    }
  });

// fallow-ignore-next-line unused-export
export async function pollPendingFullOutputSyncs(deps: SpawnDeps): Promise<void> {
  return Effect.runPromise(pollPendingFullOutputSyncsEffect(deps));
}

/** Effect twin — cleanup and status update when a spawned process exits. */
const finalizeRunEffect = (
  deps: SpawnDeps,
  tracked: RunningProcess,
  runId: any,
  runIdStr: string,
  commandKey: string,
  code: number | null,
  signal: NodeJS.Signals | null
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    clearInterval(tracked.flushTimer);
    if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);

    if (tracked.process.pid != null) {
      untrackChildPid(tracked.process.pid);
    }

    yield* flushFinalChunksEffect(deps, tracked, runId);
    yield* Effect.tryPromise({
      try: () => tracked.store.destroy(),
      catch: (e) => e,
    }).pipe(Effect.catchAll(() => Effect.void));
    processManager.unregister(runIdStr, commandKey);

    const status = deriveTerminalStatus(code, signal, tracked.terminationIntent);
    yield* Effect.tryPromise({
      try: () =>
        deps.backend.mutation(api.commands.updateRunStatus, {
          sessionId: deps.sessionId as SessionId,
          machineId: deps.machineId,
          runId,
          status,
          exitCode: code ?? undefined,
        }),
      catch: (e) => e,
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          console.warn(
            `[${formatTimestamp()}] ⚠️ Failed to update run status on exit:`,
            err instanceof Error ? err.message : String(err)
          );
        })
      )
    );
  });

/** Effect twin — spawn a command process and wire output/status lifecycle. */
// fallow-ignore-next-line unused-export
export const spawnCommandProcessEffect = (
  deps: SpawnDeps,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  },
  commandKey: string
): Effect.Effect<RunningProcess, never, never> =>
  Effect.gen(function* () {
    const { workingDir, commandName, script, runId } = event;
    const runIdStr = runId.toString();

    if (!tempDirReady) {
      yield* Effect.tryPromise({
        try: () => ensureTempDir(),
        catch: (e) => e,
      }).pipe(Effect.catchAll(() => Effect.void));
      tempDirReady = true;
    }

    const store = createOutputStore(runIdStr);

    return yield* Effect.sync(() => {
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
        store,
        startedAt: Date.now(),
        flushTimer: setInterval(() => {
          Effect.runPromise(flushTailV2Effect(deps, tracked)).catch(() => {});
          Effect.runPromise(syncFullOutputOnRequestEffect(deps, tracked, runId)).catch(() => {});
        }, OUTPUT_FLUSH_INTERVAL_MS),
        softTimeoutTimer: null,
        terminationIntent: null,
      };
      tracked.flushTimer.unref?.();

      processManager.register(runIdStr, commandKey, tracked);

      if (child.pid != null) {
        trackChildPid(child.pid);
      }

      const softTimeoutTimer = setTimeout(() => {
        console.log(
          `[${formatTimestamp()}] ⏰ Command soft timeout (24h): ${commandName} (runId: ${runIdStr})`
        );
        const currentTracked = processManager.get(runIdStr);
        if (!currentTracked) return;

        currentTracked.terminationIntent = 'killed';

        void Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () =>
                deps.backend.mutation(api.commands.updateRunStatus, {
                  sessionId: deps.sessionId as SessionId,
                  machineId: deps.machineId,
                  runId,
                  status: 'killed',
                  terminationReason: 'timeout-24h',
                }),
              catch: (e) => e,
            }).pipe(
              Effect.catchAll((err) =>
                Effect.sync(() => {
                  console.warn(
                    `[${formatTimestamp()}] ⚠️ Failed to mark run as killed (timeout):`,
                    err instanceof Error ? err.message : String(err)
                  );
                })
              )
            );
          })
        );

        killProcess(child, 'SIGTERM');
        setTimeout(() => {
          if (!processManager.has(runIdStr)) return;
          console.log(`[${formatTimestamp()}] 🔪 Force-killing timed-out process: ${runIdStr}`);
          killProcess(child, 'SIGKILL');
        }, SIGTERM_GRACE_PERIOD_MS);
      }, SOFT_TIMEOUT_MS);
      softTimeoutTimer.unref?.();
      tracked.softTimeoutTimer = softTimeoutTimer;

      child.stdout?.on('data', (data: Buffer) => {
        tracked.store.append(data.toString()).catch(() => {});
      });

      child.stderr?.on('data', (data: Buffer) => {
        tracked.store.append(data.toString()).catch(() => {});
      });

      const finalize = (code: number | null, signal: NodeJS.Signals | null) =>
        Effect.runPromise(
          finalizeRunEffect(deps, tracked, runId, runIdStr, commandKey, code, signal)
        );

      child.on('exit', (code, signal) => {
        console.log(
          `[${formatTimestamp()}] 📋 Command exited: ${commandName} (code=${code}, signal=${signal})`
        );
        finalize(code, signal as NodeJS.Signals | null).catch(() => {});
      });

      child.on('error', (err) => {
        console.error(
          `[${formatTimestamp()}] ❌ Command spawn failed: ${commandName}: ${err.message}`
        );
        finalize(null, null).catch(() => {});
      });

      return tracked;
    });
  });

export async function spawnCommandProcess(
  deps: SpawnDeps,
  event: {
    workingDir: string;
    commandName: string;
    script: string;
    runId: any;
  },
  commandKey: string
): Promise<RunningProcess> {
  return Effect.runPromise(spawnCommandProcessEffect(deps, event, commandKey));
}
