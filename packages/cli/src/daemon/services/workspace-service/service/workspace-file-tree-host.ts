/**
 * Per-directory file-tree sync, owned by `WorkspaceService`.
 *
 * Each working directory has at most one live coordinator. Its checkpoint and delta sends go
 * through the file-tree outbox registries, which this host creates and stops. The file-tree
 * subscription adapter drives the host for requests and leases; it does not own any of this state.
 */

import { api } from '../../../../api.js';
import { scanFileTree } from '../../../../infrastructure/services/workspace/file-tree-scanner.js';
import type { GitRootSnapshotReader } from '../../../../infrastructure/services/workspace/git-workspace-change-source.js';
import { normalizeWorkingDirForLookup } from '../../../../infrastructure/services/workspace/normalize-working-dir.js';
import {
  startWorkspaceFileTreeCoordinator,
  type WorkspaceFileTreeCoordinator,
} from '../../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { getErrorMessage, isFileTreeSyncDisabledError } from '../../../../utils/convex-error.js';
import type { DaemonSessionServiceShape } from '../../../entry/daemon-services.js';
import { formatTimestamp } from '../../../entry/daemon-utils.js';
import {
  createWorkspaceFileTreeCheckpointOutboxRegistry,
  createWorkspaceFileTreeDeltaOutboxRegistry,
  type WorkspaceFileTreeCheckpointOutboxRegistry,
  type WorkspaceFileTreeDeltaOutboxRegistry,
} from '../../../infrastructure/outbox/index.js';
import { createWorkspaceFileTreeCheckpointSend } from '../../../infrastructure/outbox/workspace-file-tree-checkpoint-send.js';
import { createWorkspaceFileTreeDeltaSend } from '../../../infrastructure/outbox/workspace-file-tree-delta-send.js';

type FileTreeSession = Pick<DaemonSessionServiceShape, 'sessionId' | 'machineId' | 'backend'>;

type CoordinatorMap = Map<string, Promise<WorkspaceFileTreeCoordinator>>;

function logFileTreeWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface WorkspaceFileTreeHost {
  /** Starts the coordinator for `workingDir` if none is live. `forceReconcile` also reconciles it. */
  ensure(
    workingDir: string,
    opts: { forceReconcile: boolean }
  ): Promise<WorkspaceFileTreeCoordinator>;
  /** Stops the coordinator and its outbox registries for `workingDir`. Does not log. */
  stop(workingDir: string): Promise<void>;
  /** Stops file-tree sync for `workingDir` and logs that it is disabled. */
  disable(workingDir: string): Promise<void>;
  /** Publishes one checkpoint without a coordinator, then fulfils the request unless sync is disabled. */
  oneShot(workingDir: string): Promise<void>;
  /** Stops every coordinator, then both outbox registries. */
  stopAll(): Promise<void>;
}

async function runOneShotFileTreeSync(
  session: FileTreeSession,
  workingDir: string,
  coordinators: CoordinatorMap,
  checkpointOutboxRegistry: WorkspaceFileTreeCheckpointOutboxRegistry | undefined,
  deltaOutboxRegistry: WorkspaceFileTreeDeltaOutboxRegistry | undefined
): Promise<void> {
  const normalized = normalizeWorkingDirForLookup(workingDir);
  let syncDisabled = false;
  try {
    const tree = await scanFileTree(normalized);
    const send = createWorkspaceFileTreeCheckpointSend(session, normalized, {
      onSyncDisabled: () => {
        syncDisabled = true;
      },
    });
    await send({ tree, revision: 0 });
    if (syncDisabled) {
      await stopFileTreeSyncForDir(
        coordinators,
        checkpointOutboxRegistry,
        deltaOutboxRegistry,
        normalized
      );
      return;
    }
    await session.backend.mutation(api.workspaceFiles.fulfillFileTreeRequest, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir: normalized,
    });
  } catch (error: unknown) {
    if (!isFileTreeSyncDisabledError(error)) throw error;
    await stopFileTreeSyncForDir(
      coordinators,
      checkpointOutboxRegistry,
      deltaOutboxRegistry,
      normalized
    );
  }
}

async function stopCoordinatorForWorkingDir(
  coordinators: CoordinatorMap,
  checkpointOutboxRegistry: WorkspaceFileTreeCheckpointOutboxRegistry | undefined,
  deltaOutboxRegistry: WorkspaceFileTreeDeltaOutboxRegistry | undefined,
  normalized: string
): Promise<void> {
  const coordinatorPromise = coordinators.get(normalized);
  if (coordinatorPromise) {
    coordinators.delete(normalized);
    await coordinatorPromise.then((coordinator) => coordinator.stop()).catch(() => undefined);
  }
  await checkpointOutboxRegistry?.stop(normalized);
  await deltaOutboxRegistry?.stop(normalized);
}

async function stopFileTreeSyncForDir(
  coordinators: CoordinatorMap,
  checkpointOutboxRegistry: WorkspaceFileTreeCheckpointOutboxRegistry | undefined,
  deltaOutboxRegistry: WorkspaceFileTreeDeltaOutboxRegistry | undefined,
  normalized: string
): Promise<void> {
  await stopCoordinatorForWorkingDir(
    coordinators,
    checkpointOutboxRegistry,
    deltaOutboxRegistry,
    normalized
  );
  console.log(`[${formatTimestamp()}] 🌳 File tree sync disabled: ${normalized}`);
}

/**
 * Creates the file-tree host for one daemon session. Creating it opens both file-tree outbox
 * stores, so it runs once, when the workspace service is built.
 *
 * Constraints:
 * - Keys are normalized before lookup, so `/a` and `/a/` share one coordinator.
 * - A failed coordinator start removes its map entry, so the next `ensure` retries.
 * - Root snapshots come only from `getRootSnapshotReader`. A reader that resolves `undefined`
 *   leaves the coordinator on the direct root read.
 */
export function createWorkspaceFileTreeHost(deps: {
  session: FileTreeSession;
  getRootSnapshotReader: (workingDir: string) => Promise<GitRootSnapshotReader | undefined>;
}): WorkspaceFileTreeHost {
  const { session, getRootSnapshotReader } = deps;
  const coordinators: CoordinatorMap = new Map();
  const checkpointOutboxRegistry = createWorkspaceFileTreeCheckpointOutboxRegistry(
    session.machineId,
    (normalized) => {
      const onSyncDisabled = () =>
        stopFileTreeSyncForDir(
          coordinators,
          checkpointOutboxRegistry,
          deltaOutboxRegistry,
          normalized
        );
      const send = createWorkspaceFileTreeCheckpointSend(session, normalized, {
        onSyncDisabled,
      });
      return async (state) => {
        const result = await send(state);
        console.log(
          `[${formatTimestamp()}] 🌳 File tree checkpoint: ${normalized} (${state.tree.entries.length} entries, revision ${result.revision})`
        );
        return result;
      };
    },
    {
      onError: (normalized, error) => {
        if (isFileTreeSyncDisabledError(error)) {
          void stopFileTreeSyncForDir(
            coordinators,
            checkpointOutboxRegistry,
            deltaOutboxRegistry,
            normalized
          ).catch(() => undefined);
          return;
        }
        logFileTreeWarn(`File tree checkpoint outbox failed for ${normalized}`, error);
      },
    }
  );
  const deltaOutboxRegistry = createWorkspaceFileTreeDeltaOutboxRegistry(
    session.machineId,
    (normalized) => {
      const onSyncDisabled = () =>
        stopFileTreeSyncForDir(
          coordinators,
          checkpointOutboxRegistry,
          deltaOutboxRegistry,
          normalized
        );
      return createWorkspaceFileTreeDeltaSend(session, normalized, { onSyncDisabled });
    },
    {
      onError: (normalized, error) => {
        if (isFileTreeSyncDisabledError(error)) {
          void stopFileTreeSyncForDir(
            coordinators,
            checkpointOutboxRegistry,
            deltaOutboxRegistry,
            normalized
          ).catch(() => undefined);
          return;
        }
        logFileTreeWarn(`File tree delta outbox failed for ${normalized}`, error);
      },
    }
  );

  const startCoordinator = (normalized: string): Promise<WorkspaceFileTreeCoordinator> =>
    getRootSnapshotReader(normalized).then((readRootSnapshot) =>
      startWorkspaceFileTreeCoordinator({
        machineId: session.machineId,
        workingDir: normalized,
        readRootSnapshot,
        // This coordinator needs server revisions before advancing its manifest.
        // Lifecycle commands use persistence-only enqueue instead.
        onDelta: (delta, baseRevision) =>
          deltaOutboxRegistry.enqueueAndWait(normalized, { delta, baseRevision }),
        onCheckpoint: (tree, revision) =>
          checkpointOutboxRegistry.enqueueAndWait(normalized, { tree, revision }),
        onError: (error) =>
          logFileTreeWarn(`File tree coordinator failed for ${normalized}`, error),
        onReconciled: (correctedPathCount) => {
          console.log(
            `[${formatTimestamp()}] 🌳 File tree reconciled: ${normalized} (${correctedPathCount} corrected paths)`
          );
        },
      })
    );

  const ensure = (
    workingDir: string,
    { forceReconcile }: { forceReconcile: boolean }
  ): Promise<WorkspaceFileTreeCoordinator> => {
    const normalized = normalizeWorkingDirForLookup(workingDir);
    let coordinatorPromise = coordinators.get(normalized);
    if (!coordinatorPromise) {
      // Stored synchronously, before the await, so concurrent ensures share one start.
      coordinatorPromise = startCoordinator(normalized).catch((error) => {
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
    ensure,
    stop: (workingDir) =>
      stopCoordinatorForWorkingDir(
        coordinators,
        checkpointOutboxRegistry,
        deltaOutboxRegistry,
        normalizeWorkingDirForLookup(workingDir)
      ),
    disable: (workingDir) =>
      stopFileTreeSyncForDir(
        coordinators,
        checkpointOutboxRegistry,
        deltaOutboxRegistry,
        normalizeWorkingDirForLookup(workingDir)
      ),
    oneShot: (workingDir) =>
      runOneShotFileTreeSync(
        session,
        workingDir,
        coordinators,
        checkpointOutboxRegistry,
        deltaOutboxRegistry
      ),
    stopAll: async () => {
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
    },
  };
}
