import { gzipSync } from 'node:zlib';

import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';
import {
  toLegacyBlobSyncArgs,
  type BlobSnapshotPayload,
} from '@workspace/backend/src/domain/workspace-file-tree/transport/blob-snapshot.js';
import type { FileTreeSnapshotRef } from '@workspace/backend/src/domain/workspace-file-tree/types.js';

import { api } from '../../../../api.js';
import type { DaemonSessionServiceShape } from '../../../../daemon/entry/daemon-services.js';

export function buildBlobSnapshotPayload(tree: FileTree, dataHash: string): BlobSnapshotPayload {
  const compressed = gzipSync(Buffer.from(JSON.stringify(tree))).toString('base64');
  return {
    data: { compression: 'gzip', content: compressed },
    dataHash,
    scannedAt: tree.scannedAt,
  };
}

export async function publishBlobSnapshot(
  session: DaemonSessionServiceShape,
  workingDir: string,
  payload: BlobSnapshotPayload
): Promise<FileTreeSnapshotRef> {
  await session.backend.mutation(api.workspaceFiles.syncFileTreeV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    ...toLegacyBlobSyncArgs(payload),
  });
  return {
    strategyId: 'blob',
    snapshotId: payload.dataHash,
    scannedAt: payload.scannedAt,
    entryCount: 0,
  };
}
