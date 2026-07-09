'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import type { ExplorerTreeNode } from './explorer-tree';
import { fileTreeEntriesToExplorerNodes, fileTreeEntriesToFileEntries } from './fileTreeUtils';
import {
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeScannedAt,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from './workspaceFileTreeStore';
import { useDecompressedQueryJson } from '../hooks/useDecompressedQueryJson';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const REFRESH_DEDUP_WINDOW_MS = 1500;
const EMPTY_FILE_ENTRIES: FileEntry[] = [];
const EMPTY_ROOT_NODES: ExplorerTreeNode[] = [];

export interface UseWorkspaceFileTreeArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
}

export interface UseWorkspaceFileTreeResult {
  entries: FileEntry[];
  rootNodes: ExplorerTreeNode[];
  scannedAt: number | null;
  isLoading: boolean;
  hasTree: boolean;
  refresh: (options?: { force?: boolean }) => void;
}

// fallow-ignore-next-line complexity
export function useWorkspaceFileTree({
  machineId,
  workingDir,
  enabled = true,
}: UseWorkspaceFileTreeArgs): UseWorkspaceFileTreeResult {
  const lastRefreshAtRef = useRef<number | null>(null);
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);

  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);

  const raw = useSessionQuery(
    api.workspaceFiles.getFileTreeV2,
    enabled ? { machineId, workingDir: normalizedWorkingDir } : 'skip'
  );
  const json = useDecompressedQueryJson(raw, enabled);

  const parsed = useMemo((): FileTree | null | undefined => {
    if (!enabled) return undefined;
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (json === undefined) return undefined;
    if (json === null) return null;
    try {
      return JSON.parse(json) as FileTree;
    } catch {
      return null;
    }
  }, [enabled, json, raw]);

  useEffect(() => {
    if (!enabled || parsed === undefined || parsed === null) return;
    upsertWorkspaceFileTree(
      workspaceKey,
      parsed.entries,
      parsed.scannedAt ?? raw?.scannedAt ?? null
    );
  }, [enabled, parsed, raw?.scannedAt, workspaceKey]);

  const storeEntries = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeEntries(workspaceKey),
    () => getWorkspaceFileTreeEntries(workspaceKey)
  );

  const storeScannedAt = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeScannedAt(workspaceKey),
    () => getWorkspaceFileTreeScannedAt(workspaceKey)
  );

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

  const refresh = useCallback(
    (options?: { force?: boolean }) => {
      if (!enabled) return;

      const now = Date.now();
      if (
        lastRefreshAtRef.current !== null &&
        now - lastRefreshAtRef.current < REFRESH_DEDUP_WINDOW_MS
      ) {
        return;
      }
      lastRefreshAtRef.current = now;

      const force = !!options?.force;
      requestTree(force);
    },
    [enabled, requestTree, workspaceKey]
  );

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  const entries = useMemo(() => {
    if (!enabled) return EMPTY_FILE_ENTRIES;
    const source: FileTreeEntry[] =
      storeEntries.length > 0 ? storeEntries : (parsed?.entries ?? []);
    return fileTreeEntriesToFileEntries(source);
  }, [enabled, parsed?.entries, storeEntries]);

  const rootNodes = useMemo(() => {
    if (!enabled) return EMPTY_ROOT_NODES;
    const source: FileTreeEntry[] =
      storeEntries.length > 0 ? storeEntries : (parsed?.entries ?? []);
    return fileTreeEntriesToExplorerNodes(source);
  }, [enabled, parsed?.entries, storeEntries]);

  const scannedAt = storeScannedAt ?? parsed?.scannedAt ?? raw?.scannedAt ?? null;
  const hasTree = storeEntries.length > 0 || (parsed?.entries?.length ?? 0) > 0;
  const isLoading =
    enabled && !hasTree && (raw === undefined || (raw !== null && json === undefined));

  return useMemo(
    () => ({
      entries,
      rootNodes,
      scannedAt,
      isLoading,
      hasTree,
      refresh,
    }),
    [entries, rootNodes, scannedAt, isLoading, hasTree, refresh]
  );
}
