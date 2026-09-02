import { openDurableFifoQueueStore } from './lib/durable-fifo-queue-store.js';
import {
  createKeyedFifoBatchedOutboxRegistry,
  type KeyedFifoBatchedOutboxRegistry,
} from './lib/keyed-fifo-batched-outbox-registry.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import type { DeltaPushResult } from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import type { WorkspacePendingDelta } from '../../../infrastructure/services/workspace/workspace-sync-state.js';

export const WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE = 5;
const WORKSPACE_FILE_TREE_DELTA_OUTBOX_RETRY_DELAY_MS = 5_000;
const WORKSPACE_FILE_TREE_DELTA_OUTBOX_MAX_RETRY_DELAY_MS = 5 * 60_000;
export type WorkspaceFileTreeDeltaDeliveryUnit = {
  delta: WorkspacePendingDelta;
  baseRevision: number;
};
export type WorkspaceFileTreeDeltaOutboxRegistry = KeyedFifoBatchedOutboxRegistry<
  WorkspaceFileTreeDeltaDeliveryUnit,
  DeltaPushResult
>;
export function createWorkspaceFileTreeDeltaOutboxRegistry(
  machineId: string,
  createSend: (
    key: string
  ) => (unit: WorkspaceFileTreeDeltaDeliveryUnit) => Promise<DeltaPushResult>,
  options?: { batchSize?: number | undefined; onError?:( (key: string, e: unknown) => void) | undefined }
): WorkspaceFileTreeDeltaOutboxRegistry {
  const store = openDurableFifoQueueStore(resolveOutboxDbPath(machineId, 'file-tree-delta'));
  return createKeyedFifoBatchedOutboxRegistry({
    store,
    batchSize: options?.batchSize ?? WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE,
    createSend: (key) => async (units) => {
      const out: DeltaPushResult[] = [];
      for (const u of units) {
        const r = await createSend(key)(u);
        out.push(r);
      }
      return out;
    },
    serialize: JSON.stringify,
    deserialize: JSON.parse,
    retryDelayMs: WORKSPACE_FILE_TREE_DELTA_OUTBOX_RETRY_DELAY_MS,
    maxRetryDelayMs: WORKSPACE_FILE_TREE_DELTA_OUTBOX_MAX_RETRY_DELAY_MS,
    onError: options?.onError,
    classifyOutcome: (result, unit) =>
      result.status === 'conflict'
        ? { kind: 'retry', item: { ...unit, baseRevision: result.revision } }
        : { kind: 'success' },
  });
}
