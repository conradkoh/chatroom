'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useRequestWorkspaceFileTree } from './useRequestWorkspaceFileTree';
import {
  acquireFileTreeDeltaSync,
  isFileTreeDeltaSyncOwner,
  releaseFileTreeDeltaSync,
  subscribeFileTreeDeltaSync,
} from './workspaceFileTreeDeltaSyncCoordinator';
import { useWorkspaceFileTreeStoreRevision } from '../hooks/useWorkspaceFileTreeStoreRevision';
import {
  applyWorkspaceFileTreeDeltas,
  clearWorkspaceFileTree,
  type WorkspaceFileTreeDeltaBatch,
} from '../stores/workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

type FileTreeDeltaQueryResult =
  | {
      status: 'ok';
      deltas: WorkspaceFileTreeDeltaBatch[];
      hasMore?: true;
    }
  | { status: 'checkpoint-required'; checkpointRevision: number; currentRevision: number }
  | { status: 'resync-required'; expectedRevision: number }
  | null;

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
  const ownerId = useRef(Symbol('delta-sync-owner')).current;
  const storeRevision = useWorkspaceFileTreeStoreRevision(workspaceKey);
  const requestTree = useRequestWorkspaceFileTree({ machineId, workingDir, enabled });

  const isOwner = useSyncExternalStore(
    subscribeFileTreeDeltaSync,
    () => isFileTreeDeltaSyncOwner(machineId, workingDir, ownerId),
    () => isFileTreeDeltaSyncOwner(machineId, workingDir, ownerId)
  );

  useEffect(() => {
    if (!enabled) return;
    acquireFileTreeDeltaSync(machineId, workingDir, ownerId);
    return () => releaseFileTreeDeltaSync(machineId, workingDir, ownerId);
  }, [enabled, machineId, workingDir, ownerId]);

  const deltaResult = useSessionQuery(
    api.workspaceFiles.getFileTreeDeltas,
    enabled && isOwner && storeRevision !== null
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
