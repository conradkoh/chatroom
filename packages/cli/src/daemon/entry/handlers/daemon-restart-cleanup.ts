/**
 * Daemon Restart Cleanup — clears stale PIDs and reaps orphan command runs on daemon startup.
 * Extracted from init.ts recoverState() for Effect migration.
 */

import { Effect } from 'effect';

import { api } from '../../../api.js';
import { BackendService } from '../../../infrastructure/services/backend.js';
import { AgentLifecycleOutboxService, DaemonSessionService } from '../daemon-services.js';
import { buildAgentLifecycleRevisionKey } from '../../domain/entities/agent-lifecycle-fact.js';

/** Clear all stale spawnedAgentPid values for this machine. */
export const clearStaleSpawnedPidsEffect = (): Effect.Effect<
  number,
  Error,
  AgentLifecycleOutboxService | DaemonSessionService
> =>
  Effect.gen(function* () {
    const outbox = yield* AgentLifecycleOutboxService;
    const session = yield* DaemonSessionService;
    const emittedAt = Date.now();
    const result = yield* outbox.enqueue({
      kind: 'cleared_all_pids',
      revisionKey: buildAgentLifecycleRevisionKey('cleared_all', {
        machineId: session.machineId,
        emittedAt,
      }),
      emittedAt,
    });
    return result.clearedCount ?? 0;
  });

/** Reap pending/running command runs orphaned from previous daemon process. */
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
