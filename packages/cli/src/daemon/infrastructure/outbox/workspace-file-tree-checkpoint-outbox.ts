import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

import { openDurableCoalescingStateStore } from './lib/durable-coalescing-state-store.js';
import {
  createKeyedCoalescingStateOutboxRegistry,
  type KeyedCoalescingStateOutboxRegistry,
} from './lib/keyed-coalescing-state-outbox-registry.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';

// fallow-ignore-next-line unused-export
export const WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MIN_INTERVAL_MS = 5_000;
// fallow-ignore-next-line unused-export
export const WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_RETRY_DELAY_MS = 5_000;
// fallow-ignore-next-line unused-export
export const WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MAX_RETRY_DELAY_MS = 5 * 60_000;

export type WorkspaceFileTreeCheckpointState = {
  tree: FileTree;
  revision: number;
};

export type WorkspaceFileTreeCheckpointSendResult = { revision: number };

export type WorkspaceFileTreeCheckpointOutboxRegistry = KeyedCoalescingStateOutboxRegistry<
  WorkspaceFileTreeCheckpointState,
  WorkspaceFileTreeCheckpointSendResult
>;

export function createWorkspaceFileTreeCheckpointOutboxRegistry(
  machineId: string,
  createSend: (
    normalizedWorkingDir: string
  ) => (state: WorkspaceFileTreeCheckpointState) => Promise<WorkspaceFileTreeCheckpointSendResult>,
  options?: { onError?: (normalizedWorkingDir: string, error: unknown) => void }
): WorkspaceFileTreeCheckpointOutboxRegistry {
  return createKeyedCoalescingStateOutboxRegistry({
    store: openDurableCoalescingStateStore(resolveOutboxDbPath(machineId, 'file-tree-checkpoint')),
    serialize: JSON.stringify,
    deserialize: JSON.parse,
    createSend,
    minIntervalMs: WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MIN_INTERVAL_MS,
    retryDelayMs: WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_RETRY_DELAY_MS,
    maxRetryDelayMs: WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MAX_RETRY_DELAY_MS,
    onError: options?.onError,
  });
}
