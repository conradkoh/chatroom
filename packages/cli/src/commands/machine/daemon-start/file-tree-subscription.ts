/**
 * File Tree Subscription — cached, incremental workspace file-tree synchronization.
 *
 * A request ensures a persisted cache and Chokidar watcher exist. Cold caches publish
 * one V2/V3 checkpoint; normal filesystem changes are sent as revisioned deltas.
 */

import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { computeFileTreeDataHash } from '../../../infrastructure/services/workspace/file-tree-data-hash.js';
import { shouldUseV3Upload } from '../../../infrastructure/services/workspace/file-tree-partition.js';
import { uploadFileTreeV3 } from '../../../infrastructure/services/workspace/file-tree-v3-upload.js';
import { normalizeWorkingDirForLookup } from '../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  startWorkspaceFileTreeCoordinator,
  type WorkspaceFileTreeCoordinator,
} from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import type { WorkspacePendingDelta } from '../../../infrastructure/services/workspace/workspace-sync-state.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface FileTreeSubscriptionHandle {
  stop: () => void;
}

async function syncScannedFileTree(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  tree: ReturnType<WorkspaceFileTreeCoordinator['getTree']>,
  dataHash: string,
  syncGeneration: string
): Promise<{ snapshotKind: 'v2' | 'v3'; snapshotId: string }> {
  if (shouldUseV3Upload(tree)) {
    await uploadFileTreeV3(session, normalizedWorkingDir, tree, syncGeneration);
    return { snapshotKind: 'v3', snapshotId: syncGeneration };
  }
  const treeJson = JSON.stringify(tree);
  const compressed = gzipSync(Buffer.from(treeJson)).toString('base64');
  await session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir: normalizedWorkingDir,
    data: { compression: 'gzip', content: compressed },
    dataHash,
    scannedAt: tree.scannedAt,
  });
  return { snapshotKind: 'v2', snapshotId: dataHash };
}

function toDeltaOperations(delta: WorkspacePendingDelta) {
  return [
    ...delta.added.map((entry) => ({
      operation: 'add' as const,
      path: entry.path,
      entryType: entry.type,
    })),
    ...delta.removed.map((entryPath) => ({
      operation: 'remove' as const,
      path: entryPath,
    })),
    ...delta.typeChanged.map((entry) => ({
      operation: 'type-change' as const,
      path: entry.path,
      entryType: entry.type,
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

export const startFileTreeSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<FileTreeSubscriptionHandle, never, DaemonSessionService> =>
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

    const unsubscribe = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileTreeRequests,
      { sessionId: session.sessionId, machineId: session.machineId },
      // fallow-ignore-next-line complexity
      (requests) => {
        if (!requests?.length) return;

        const requestsByDir = new Map<string, boolean>();
        for (const request of requests) {
          const normalized = normalizeWorkingDirForLookup(request.workingDir);
          requestsByDir.set(
            normalized,
            requestsByDir.get(normalized) === true || request.force === true
          );
        }

        for (const [normalized, force] of requestsByDir) {
          const start = Date.now();
          void ensureCoordinator(normalized, force)
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
        }
      },
      (err: unknown) => {
        logSubscriptionWarn('File tree subscription error', err);
      }
    );

    console.log(`[${formatTimestamp()}] 🌳 File tree subscription started (reactive)`);

    return {
      stop: () => {
        unsubscribe();
        void Promise.all(
          [...coordinators.values()].map((coordinator) =>
            coordinator.then((handle) => handle.stop()).catch(() => undefined)
          )
        );
        coordinators.clear();
        console.log(`[${formatTimestamp()}] 🌳 File tree subscription stopped`);
      },
    };
  });
