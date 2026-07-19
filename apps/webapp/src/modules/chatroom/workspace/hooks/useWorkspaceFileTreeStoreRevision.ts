'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  getWorkspaceFileTreeRevision,
  subscribeWorkspaceFileTree,
} from '../stores/workspaceFileTreeStore';

export function useWorkspaceFileTreeStoreRevision(workspaceKey: string): number | null {
  return useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeRevision(workspaceKey),
    () => getWorkspaceFileTreeRevision(workspaceKey)
  );
}
