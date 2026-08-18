/**
 * File Tree Subscription — cached, incremental workspace file-tree synchronization.
 *
 * A request ensures a persisted cache and Chokidar watcher exist. Cold caches publish
 * one V2/V3 checkpoint; normal filesystem changes are sent as revisioned deltas.
 */

import { randomUUID } from 'node:crypto';

import { selectFileTreeSnapshotStrategyId } from '@workspace/backend/src/domain/workspace-file-tree/index.js';
import { Effect } from 'effect';

import { api } from '../../../api.js';
import { computeFileTreeDataHash } from '../../../infrastructure/services/workspace/file-tree-data-hash.js';
import { normalizeWorkingDirForLookup } from '../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  buildBlobSnapshotPayload,
  publishBlobSnapshot,
} from '../../../infrastructure/services/workspace/transport/blob-snapshot-publish.js';
import { publishShardedSnapshot } from '../../../infrastructure/services/workspace/transport/sharded-snapshot-publish.js';
import {
  startWorkspaceFileTreeCoordinator,
  type WorkspaceFileTreeCoordinator,
} from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { enqueueFileTreeSync } from '../../../infrastructure/services/workspace/workspace-sync-queue.js';
import type { WorkspacePendingDelta } from '../../../infrastructure/services/workspace/workspace-sync-state.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
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
  normalized: string
): Promise<void> {
  const coordinatorPromise = coordinators.get(normalized);
  if (!coordinatorPromise) return;
  coordinators.delete(normalized);
  await coordinatorPromise.then((coordinator) => coordinator.stop()).catch(() => undefined);
}

async function drainPendingFileTreeReleaseRequests(
  session: DaemonSessionServiceShape,
  coordinators: Map<string, Promise<WorkspaceFileTreeCoordinator>>
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
    await stopCoordinatorForWorkingDir(coordinators, normalized)
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

async function syncScannedFileTree(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  tree: ReturnType<WorkspaceFileTreeCoordinator['getTree']>,
  dataHash: string,
  syncGeneration: string
): Promise<{ strategyId: 'blob' | 'sharded'; snapshotId: string }> {
  if (selectFileTreeSnapshotStrategyId(tree) === 'sharded') {
    const ref = await publishShardedSnapshot(session, normalizedWorkingDir, tree, syncGeneration);
    return { strategyId: ref.strategyId, snapshotId: ref.snapshotId };
  }
  const ref = await publishBlobSnapshot(
    session,
    normalizedWorkingDir,
    buildBlobSnapshotPayload(tree, dataHash)
  );
  return { strategyId: ref.strategyId, snapshotId: ref.snapshotId };
}

function toDeltaOperations(delta: WorkspacePendingDelta) {
  return [
    ...delta.added.map((entry) => ({
      o: 'a' as const,
      p: entry.path,
      e: entry.type === 'directory' ? ('d' as const) : ('f' as const),
    })),
    ...delta.removed.map((entryPath) => ({
      o: 'r' as const,
      p: entryPath,
    })),
    ...delta.typeChanged.map((entry) => ({
      o: 't' as const,
      p: entry.path,
      e: entry.type === 'directory' ? ('d' as const) : ('f' as const),
    })),
  ];
}

async function publishCheckpoint(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  tree: ReturnType<WorkspaceFileTreeCoordinator['getTree']>,
  revision: number
): Promise<{ revision: number }> {
  const dataHash = computeFileTreeDataHash(tree);
  const syncGeneration = randomUUID();
  const snapshot = await syncScannedFileTree(
    session,
    normalizedWorkingDir,
    tree,
    dataHash,
    syncGeneration
  );
  let checkpointRevision = revision;
  let result = await session.backend.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalizedWorkingDir,
    revision: checkpointRevision,
    ...snapshot,
  });
  if (result.status === 'resync-required') {
    checkpointRevision = result.expectedRevision + 1;
    result = await session.backend.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir: normalizedWorkingDir,
      revision: checkpointRevision,
      ...snapshot,
    });
  }
  if (result.status === 'snapshot-missing') {
    throw new Error(`File tree checkpoint rejected: ${result.status}`);
  }
  console.log(
    `[${formatTimestamp()}] 🌳 File tree checkpoint: ${normalizedWorkingDir} (${tree.entries.length} entries, revision ${checkpointRevision})`
  );
  return { revision: checkpointRevision };
}

export const startFileTreeSubscriptionEffect = (): Effect.Effect<
  FileTreeSubscriptionHandle,
  never,
  DaemonSessionService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const coordinators = new Map<string, Promise<WorkspaceFileTreeCoordinator>>();

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
          onDelta: async (delta, baseRevision) => {
            const operations = toDeltaOperations(delta);
            const result = await session.backend.mutation(
              api.workspaceFiles.applyFileTreeDeltaBatch,
              {
                sessionId: session.sessionId,
                machineId: session.machineId,
                workingDir: normalized,
                operationId: delta.operationId,
                baseRevision,
                operations,
              }
            );
            if (result.status === 'resync-required') {
              return { status: 'conflict' as const, revision: result.expectedRevision };
            }
            console.log(
              `[${formatTimestamp()}] 🌳 File tree delta: ${normalized} (${operations.length} operations, ${Buffer.byteLength(JSON.stringify(operations))} bytes, revision ${result.revision})`
            );
            return result;
          },
          onCheckpoint: (tree, revision) => publishCheckpoint(session, normalized, tree, revision),
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
        drainPendingFileTreeReleaseRequests(session, coordinators),
      stop: () => {
        void Promise.all(
          [...coordinators.values()].map((coordinator) =>
            coordinator.then((handle) => handle.stop()).catch(() => undefined)
          )
        );
        coordinators.clear();
      },
    };
  });
