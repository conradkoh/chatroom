import type { WorkspaceFileTreeDeltaDeliveryUnit } from './workspace-file-tree-delta-outbox.js';
import { api } from '../../../api.js';
import type { DeltaPushResult } from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import type { WorkspacePendingDelta } from '../../../infrastructure/services/workspace/workspace-sync-state.js';
import { isFileTreeSyncDisabledError } from '../../../utils/convex-error.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';

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

/** One outbox delivery: maps backend resync to conflict for FIFO outbox retry. */
export function createWorkspaceFileTreeDeltaSend(
  session: DaemonSessionServiceShape,
  normalizedWorkingDir: string,
  options?: { onSyncDisabled?: () => void | Promise<void> }
): (unit: WorkspaceFileTreeDeltaDeliveryUnit) => Promise<DeltaPushResult> {
  // fallow-ignore-next-line complexity
  return async (unit) => {
    try {
      const result = await session.backend.mutation(api.workspaceFiles.applyFileTreeDeltaBatch, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        workingDir: normalizedWorkingDir,
        operationId: unit.delta.operationId,
        baseRevision: unit.baseRevision,
        operations: toDeltaOperations(unit.delta),
      });
      if (result.status === 'resync-required') {
        return { status: 'conflict', revision: result.expectedRevision };
      }
      return result;
    } catch (error: unknown) {
      if (!isFileTreeSyncDisabledError(error)) throw error;
      await options?.onSyncDisabled?.();
      return { status: 'applied', revision: unit.baseRevision };
    }
  };
}
