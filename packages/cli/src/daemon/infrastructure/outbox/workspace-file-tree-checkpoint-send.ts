import { randomUUID } from 'node:crypto';

import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';
import { selectFileTreeSnapshotStrategyId } from '@workspace/backend/src/domain/workspace-file-tree/index.js';

import type {
  WorkspaceFileTreeCheckpointSendResult,
  WorkspaceFileTreeCheckpointState,
} from './workspace-file-tree-checkpoint-outbox.js';
import type { PublishCheckpointResult } from '../../../../../../services/backend/convex/workspaceFileTree/types.js';
import { api } from '../../../api.js';
import { computeFileTreeDataHash } from '../../../infrastructure/services/workspace/file-tree-data-hash.js';
import {
  buildBlobSnapshotPayload,
  publishBlobSnapshot,
} from '../../../infrastructure/services/workspace/transport/blob-snapshot-publish.js';
import { publishShardedSnapshot } from '../../../infrastructure/services/workspace/transport/sharded-snapshot-publish.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

type FileTreeCheckpointSnapshot = { strategyId: 'blob' | 'sharded'; snapshotId: string };
function needsMoreCheckpointPrune(result: PublishCheckpointResult): boolean {
  return (
    (result.status === 'published' || result.status === 'unchanged') &&
    result.pruneComplete === false
  );
}

function assertCheckpointAccepted(result: PublishCheckpointResult): void {
  if (result.status === 'snapshot-missing' || result.status === 'resync-required') {
    throw new Error(`File tree checkpoint rejected: ${result.status}`);
  }
}

async function syncScannedFileTree(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  tree: FileTree,
  dataHash: string,
  syncGeneration: string
): Promise<FileTreeCheckpointSnapshot> {
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

/** One outbox delivery: snapshot upload + checkpoint publish, including batched prune/resync steps. */
async function publishCheckpointUntilPruned(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  snapshot: FileTreeCheckpointSnapshot,
  revision: number
): Promise<number> {
  let checkpointRevision = revision;
  const publish = () =>
    session.backend.mutation(api.workspaceFiles.publishFileTreeCheckpoint, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir: normalizedWorkingDir,
      revision: checkpointRevision,
      ...snapshot,
    });
  let result = await publish();
  if (result.status === 'resync-required') {
    checkpointRevision = result.expectedRevision + 1;
    result = await publish();
  }
  while (needsMoreCheckpointPrune(result)) result = await publish();
  assertCheckpointAccepted(result);
  return checkpointRevision;
}

export function createWorkspaceFileTreeCheckpointSend(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string
): (state: WorkspaceFileTreeCheckpointState) => Promise<WorkspaceFileTreeCheckpointSendResult> {
  return async (state) => {
    const snapshot = await syncScannedFileTree(
      session,
      normalizedWorkingDir,
      state.tree,
      computeFileTreeDataHash(state.tree),
      randomUUID()
    );
    const revision = await publishCheckpointUntilPruned(
      session,
      normalizedWorkingDir,
      snapshot,
      state.revision
    );
    return { revision };
  };
}
