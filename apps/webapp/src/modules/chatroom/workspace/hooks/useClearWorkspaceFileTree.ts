'use client';

import { useCallback } from 'react';

import { clearWorkspaceFileTree, toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

/** Clear cached file-tree entries for a workspace. Prefer this over importing the store in components. */
export function useClearWorkspaceFileTree() {
  return useCallback((machineId: string, workingDir: string) => {
    clearWorkspaceFileTree(toWorkspaceFileTreeKey(machineId, workingDir));
  }, []);
}
