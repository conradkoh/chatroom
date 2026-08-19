import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

import {
  createKeyedCoalescingStateOutboxRegistry,
  type KeyedCoalescingStateOutboxRegistry,
} from './keyed-coalescing-state-outbox-registry.js';

export const WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MIN_INTERVAL_MS = 5_000;

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
  createSend: (normalizedWorkingDir: string) =>
    (state: WorkspaceFileTreeCheckpointState) => Promise<WorkspaceFileTreeCheckpointSendResult>,
  options?: { onError?: (normalizedWorkingDir: string, error: unknown) => void }
): WorkspaceFileTreeCheckpointOutboxRegistry {
  return createKeyedCoalescingStateOutboxRegistry({
    createSend,
    minIntervalMs: WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MIN_INTERVAL_MS,
    onError: options?.onError,
  });
}
