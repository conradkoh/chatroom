/**
 * Daemon Restart Cleanup — clears stale PIDs and reaps orphan command runs on daemon startup.
 * Extracted from init.ts recoverState() for Effect migration.
 */

import { Effect } from 'effect';

import { api } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { BackendService } from '../../../../infrastructure/services/backend.js';
import { DaemonSessionService } from '../daemon-services.js';
import type { SessionId } from '../types.js';

/** Flat deps for core — no DaemonContext. */
export interface DaemonRestartCleanupDeps {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
}

/**
 * Core — clear all stale spawnedAgentPid values for this machine.
 * Returns clearedCount from backend mutation.
 */
// fallow-ignore-next-line unused-export
export async function clearStaleSpawnedPidsCore(deps: DaemonRestartCleanupDeps): Promise<number> {
  const result = await deps.backend.mutation(api.machines.clearAllSpawnedPids, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  });
  return result.clearedCount;
}

/**
 * Core — reap pending/running command runs orphaned from previous daemon process.
 * Returns reapedCount from backend mutation.
 */
// fallow-ignore-next-line unused-export
export async function reapOrphanCommandRunsCore(deps: DaemonRestartCleanupDeps): Promise<number> {
  const runResult = await deps.backend.mutation(api.commands.reapOrphansForDaemonRestart, {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  });
  return runResult.reapedCount;
}

/** Effect twin — yields BackendService + DaemonSessionService. */
export const clearStaleSpawnedPidsEffect = (): Effect.Effect<
  number,
  Error,
  BackendService | DaemonSessionService
> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const session = yield* DaemonSessionService;
    const result = yield* backend.mutation<{ clearedCount: number }>(
      api.machines.clearAllSpawnedPids,
      { sessionId: session.sessionId, machineId: session.machineId }
    );
    return result.clearedCount;
  });

/** Effect twin — yields BackendService + DaemonSessionService. */
export const reapOrphanCommandRunsEffect = (): Effect.Effect<
  number,
  Error,
  BackendService | DaemonSessionService
> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const session = yield* DaemonSessionService;
    const result = yield* backend.mutation<{ reapedCount: number }>(
      api.commands.reapOrphansForDaemonRestart,
      { sessionId: session.sessionId, machineId: session.machineId }
    );
    return result.reapedCount;
  });
