'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect } from 'react';

import { useRequestWorkspaceFileTree } from './useRequestWorkspaceFileTree';
import { useWorkspaceFileTreeStoreRevision } from './useWorkspaceFileTreeStoreRevision';
import {
  applyWorkspaceFileTreeDeltas,
  clearWorkspaceFileTree,
  type WorkspaceFileTreeDeltaBatch,
} from './workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

type FileTreeDeltaQueryResult =
  | {
      status: 'ok';
      checkpointRevision: number;
      currentRevision: number;
      deltas: WorkspaceFileTreeDeltaBatch[];
      hasMore: boolean;
    }
  | { status: 'checkpoint-required'; checkpointRevision: number; currentRevision: number }
  | { status: 'resync-required'; expectedRevision: number };

export function useWorkspaceFileTreeDeltaSync({
  workspaceKey,
  machineId,
  workingDir,
  enabled = true,
}: {
  workspaceKey: string;
  machineId: string;
  workingDir: string;
  enabled?: boolean;
}): void {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const storeRevision = useWorkspaceFileTreeStoreRevision(workspaceKey);
  const requestTree = useRequestWorkspaceFileTree({ machineId, workingDir, enabled });

  const deltaResult = useSessionQuery(
    api.workspaceFiles.getFileTreeDeltas,
    enabled && storeRevision !== null
      ? { machineId, workingDir: normalizedWorkingDir, afterRevision: storeRevision }
      : 'skip'
  ) as FileTreeDeltaQueryResult | null | undefined;

  useEffect(() => {
    if (!enabled || !deltaResult) return;
    if (deltaResult.status === 'resync-required') {
      requestTree(true);
      return;
    }
    if (deltaResult.status === 'checkpoint-required') {
      clearWorkspaceFileTree(workspaceKey);
      return;
    }
    if (deltaResult.status !== 'ok' || deltaResult.deltas.length === 0) return;
    const result = applyWorkspaceFileTreeDeltas(workspaceKey, deltaResult.deltas);
    if (result.status === 'requires-refresh') requestTree(true);
  }, [deltaResult, enabled, requestTree, workspaceKey]);
}
