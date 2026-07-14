'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { useWorkspaceFileTreeStoreRevision } from './useWorkspaceFileTreeStoreRevision';
import {
  applyWorkspaceFileTreeDeltas,
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

const deltaSyncRefCounts = new Map<string, number>();

function acquireDeltaSync(workspaceKey: string): boolean {
  const next = (deltaSyncRefCounts.get(workspaceKey) ?? 0) + 1;
  deltaSyncRefCounts.set(workspaceKey, next);
  return next === 1;
}

function releaseDeltaSync(workspaceKey: string): void {
  const next = (deltaSyncRefCounts.get(workspaceKey) ?? 1) - 1;
  if (next <= 0) deltaSyncRefCounts.delete(workspaceKey);
  else deltaSyncRefCounts.set(workspaceKey, next);
}

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
  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);
  const storeRevision = useWorkspaceFileTreeStoreRevision(workspaceKey);

  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsOwner(false);
      return;
    }
    const owner = acquireDeltaSync(workspaceKey);
    setIsOwner(owner);
    return () => {
      releaseDeltaSync(workspaceKey);
      setIsOwner(false);
    };
  }, [workspaceKey, enabled]);

  const deltaResult = useSessionQuery(
    api.workspaceFiles.getFileTreeDeltas,
    enabled && isOwner && storeRevision !== null
      ? { machineId, workingDir: normalizedWorkingDir, afterRevision: storeRevision }
      : 'skip'
  ) as FileTreeDeltaQueryResult | null | undefined;

  const requestTree = useCallback(
    (force: boolean) => {
      if (!enabled) return;
      requestMutation({
        machineId,
        workingDir: normalizedWorkingDir,
        ...(force ? { force: true } : {}),
      }).catch(() => {});
    },
    [enabled, machineId, normalizedWorkingDir, requestMutation]
  );

  useEffect(() => {
    if (!enabled || !deltaResult) return;
    if (deltaResult.status === 'resync-required') {
      requestTree(true);
      return;
    }
    if (deltaResult.status !== 'ok' || deltaResult.deltas.length === 0) return;
    const result = applyWorkspaceFileTreeDeltas(workspaceKey, deltaResult.deltas);
    if (result.status === 'requires-refresh') requestTree(true);
  }, [deltaResult, enabled, requestTree, workspaceKey]);
}
