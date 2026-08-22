/**
 * File Tree Subscription — cached, incremental workspace file-tree synchronization.
 *
 * A request ensures a persisted cache and Chokidar watcher exist. Cold caches publish
 * one V2/V3 checkpoint; normal filesystem changes are sent as revisioned deltas.
 */

import { Effect } from 'effect';

import { api } from '../../../api.js';
import { normalizeWorkingDirForLookup } from '../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  startWorkspaceFileTreeCoordinator,
  type WorkspaceFileTreeCoordinator,
} from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { enqueueFileTreeSync } from '../../../infrastructure/services/workspace/workspace-sync-queue.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import {
  createWorkspaceFileTreeCheckpointOutboxRegistry,
  createWorkspaceFileTreeDeltaOutboxRegistry,
  type WorkspaceFileTreeDeltaOutboxRegistry,
  type WorkspaceFileTreeCheckpointOutboxRegistry,
} from '../../infrastructure/outbox/index.js';
import { createWorkspaceFileTreeCheckpointSend } from '../../infrastructure/outbox/workspace-file-tree-checkpoint-send.js';
import { createWorkspaceFileTreeDeltaSend } from '../../infrastructure/outbox/workspace-file-tree-delta-send.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import { formatTimestamp } from '../daemon-utils.js';

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface FileTreeSubscriptionHandle {
  stop: () => void;
  drainPendingFileTreeRequests: () => Promise<void>;
  drainPendingFileTreeReleaseRequests: () => Promise<void>;
}

type EnsureCoordinator = (
  workingDir: string,
  forceReconcile: boolean
) => Promise<WorkspaceFileTreeCoordinator>;

async function stopCoordinatorForWorkingDir(
  coordinators: Map<string, Promise<WorkspaceFileTreeCoordinator>>,
  checkpointOutboxRegistry: WorkspaceFileTreeCheckpointOutboxRegistry,
  deltaOutboxRegistry: WorkspaceFileTreeDeltaOutboxRegistry,
  normalized: string
): Promise<void> {
  const coordinatorPromise = coordinators.get(normalized);
  if (!coordinatorPromise) return;
  coordinators.delete(normalized);
  await coordinatorPromise.then((coordinator) => coordinator.stop()).catch(() => undefined);
  await checkpointOutboxRegistry.stop(normalized);
  await deltaOutboxRegistry.stop(normalized);
}

async function drainPendingFileTreeReleaseRequests(
  session: DaemonSessionServiceShape,
  coordinators: Map<string, Promise<WorkspaceFileTreeCoordinator>>,
  checkpointOutboxRegistry: WorkspaceFileTreeCheckpointOutboxRegistry,
  deltaOutboxRegistry: WorkspaceFileTreeDeltaOutboxRegistry
): Promise<void> {
  const releases = await session.backend.query(
    api.workspaceFiles.getPendingFileTreeReleaseRequests,
    {
      sessionId: session.sessionId,
      machineId: session.machineId,
    }
  );
  if (!releases?.length) return;

  const releasesByDir = new Set<string>();
  for (const release of releases) {
    releasesByDir.add(normalizeWorkingDirForLookup(release.workingDir));
  }

  for (const normalized of releasesByDir) {
    await stopCoordinatorForWorkingDir(
      coordinators,
      checkpointOutboxRegistry,
      deltaOutboxRegistry,
      normalized
    )
      .then(() =>
        session.backend.mutation(api.workspaceFiles.fulfillFileTreeReleaseRequest, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          workingDir: normalized,
        })
      )
      .then(() => {
        console.log(`[${formatTimestamp()}] 🌳 File tree coordinator stopped: ${normalized}`);
      })
      .catch((err: unknown) => {
        logSubscriptionWarn(`File tree release failed for ${normalized}`, err);
      });
  }
}

// fallow-ignore-next-line complexity
async function processPendingFileTreeRequests(
  session: DaemonSessionServiceShape,
  coordinators: Map<string, Promise<WorkspaceFileTreeCoordinator>>,
  ensureCoordinator: EnsureCoordinator,
  requests: { workingDir: string; force?: boolean }[] | null | undefined
): Promise<void> {
  if (!requests?.length) return;

  const requestsByDir = new Map<string, boolean>();
  for (const request of requests) {
    const normalized = normalizeWorkingDirForLookup(request.workingDir);
    requestsByDir.set(normalized, requestsByDir.get(normalized) === true || request.force === true);
  }

  for (const [normalized, force] of requestsByDir) {
    await enqueueFileTreeSync(session.machineId, normalized, async () => {
      const start = Date.now();
      await ensureCoordinator(normalized, force)
        .then(() =>
          session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            workingDir: normalized,
          })
        )
        .then(() => {
          console.log(
            `[${formatTimestamp()}] 🌳 File tree ready: ${normalized} (${Date.now() - start}ms${force ? ', reconciled' : ', cached'})`
          );
        })
        .catch((err: unknown) => {
          logSubscriptionWarn(`File tree failed for ${normalized}`, err);
        });
    });
  }
}

// fallow-ignore-next-line unused-export
export async function drainPendingFileTreeRequests(
  session: DaemonSessionServiceShape,
  coordinators: Map<string, Promise<WorkspaceFileTreeCoordinator>>,
  ensureCoordinator: EnsureCoordinator
): Promise<void> {
  const requests = await session.backend.query(api.workspaceFiles.getPendingFileTreeRequests, {
    sessionId: session.sessionId,
    machineId: session.machineId,
  });
  await processPendingFileTreeRequests(session, coordinators, ensureCoordinator, requests);
}

export const startFileTreeSubscriptionEffect = (): Effect.Effect<
  FileTreeSubscriptionHandle,
  never,
  DaemonSessionService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const coordinators = new Map<string, Promise<WorkspaceFileTreeCoordinator>>();
    const checkpointOutboxRegistry = createWorkspaceFileTreeCheckpointOutboxRegistry(
      session.machineId,
      (normalized) => {
        const send = createWorkspaceFileTreeCheckpointSend(session, normalized);
        return async (state) => {
          const result = await send(state);
          console.log(
            `[${formatTimestamp()}] 🌳 File tree checkpoint: ${normalized} (${state.tree.entries.length} entries, revision ${result.revision})`
          );
          return result;
        };
      },
      {
        onError: (normalized, error) =>
          logSubscriptionWarn(`File tree checkpoint outbox failed for ${normalized}`, error),
      }
    );
    const deltaOutboxRegistry = createWorkspaceFileTreeDeltaOutboxRegistry(
      session.machineId,
      (normalized) => createWorkspaceFileTreeDeltaSend(session, normalized)
    );

    const ensureCoordinator = (
      workingDir: string,
      forceReconcile: boolean
    ): Promise<WorkspaceFileTreeCoordinator> => {
      const normalized = normalizeWorkingDirForLookup(workingDir);
      let coordinatorPromise = coordinators.get(normalized);
      if (!coordinatorPromise) {
        coordinatorPromise = startWorkspaceFileTreeCoordinator({
          machineId: session.machineId,
          workingDir: normalized,
          // Enqueue only — error retry/backoff lives in the outbox send adapters.
          onDelta: (delta, baseRevision) =>
            deltaOutboxRegistry.enqueue(normalized, { delta, baseRevision }),
          onCheckpoint: (tree, revision) =>
            checkpointOutboxRegistry.enqueue(normalized, { tree, revision }),
          onError: (error) =>
            logSubscriptionWarn(`File tree coordinator failed for ${normalized}`, error),
          onReconciled: (correctedPathCount) => {
            console.log(
              `[${formatTimestamp()}] 🌳 File tree reconciled: ${normalized} (${correctedPathCount} corrected paths)`
            );
          },
        }).catch((error) => {
          coordinators.delete(normalized);
          throw error;
        });
        coordinators.set(normalized, coordinatorPromise);
      }

      return coordinatorPromise.then(async (coordinator) => {
        const checkpoint = await session.backend.query(api.workspaceFiles.getFileTreeCheckpoint, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          workingDir: normalized,
        });
        if (checkpoint === null) await coordinator.checkpoint();
        if (forceReconcile) await coordinator.reconcile();
        return coordinator;
      });
    };

    return {
      drainPendingFileTreeRequests: () =>
        drainPendingFileTreeRequests(session, coordinators, ensureCoordinator),
      drainPendingFileTreeReleaseRequests: () =>
        drainPendingFileTreeReleaseRequests(
          session,
          coordinators,
          checkpointOutboxRegistry,
          deltaOutboxRegistry
        ),
      stop: () => {
        void (async () => {
          const keys = [...coordinators.keys()];
          await Promise.all(
            keys.map((normalized) =>
              stopCoordinatorForWorkingDir(
                coordinators,
                checkpointOutboxRegistry,
                deltaOutboxRegistry,
                normalized
              )
            )
          );
          await deltaOutboxRegistry.stopAll();
          await checkpointOutboxRegistry.stopAll();
          coordinators.clear();
        })();
      },
    };
  });
