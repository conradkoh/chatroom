'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  FileTree,
  FileTreeEntry,
} from '@workspace/backend/src/domain/entities/workspace-files';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { ExplorerTreeNode } from './explorer-tree';
import {
  fileTreeEntriesToExplorerNodes,
  fileTreeEntriesToFileEntries,
  mergeFileTreeShardPayloads,
  type FileTreeShardPayload,
} from './fileTreeUtils';
import {
  applyWorkspaceFileTreeDeltas,
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeRevision,
  getWorkspaceFileTreeScannedAt,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
  type WorkspaceFileTreeDeltaBatch,
} from './workspaceFileTreeStore';
import { useDecompressedQueryJson } from '../hooks/useDecompressedQueryJson';
import { decompressGzip } from '../utils/decompressGzip';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const REFRESH_DEDUP_WINDOW_MS = 1500;
const EMPTY_FILE_ENTRIES: FileEntry[] = [];
const EMPTY_ROOT_NODES: ExplorerTreeNode[] = [];

type FileTreeManifestV3 = {
  syncGeneration: string;
  shardIds: string[];
  totalEntryCount: number;
  complete: boolean;
  scannedAt: number;
};

type FileTreeShardV3Row = {
  shardId: string;
  data: { compression: 'gzip'; content: string };
  dataHash: string;
  scannedAt: number;
  entryCount: number;
};

type FileTreeCheckpoint = {
  revision: number;
  snapshotKind: 'v2' | 'v3';
  snapshotId: string;
  publishedAt: number;
};

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

function resolveFileTreeEntries(
  storeEntries: FileTreeEntry[],
  v3Entries: FileTreeEntry[] | null | undefined,
  parsed: FileTree | null | undefined
): FileTreeEntry[] {
  if (storeEntries.length > 0) return storeEntries;
  if (v3Entries && v3Entries.length > 0) return v3Entries;
  return parsed?.entries ?? [];
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

  const checkpoint = useSessionQuery(
    api.workspaceFiles.getFileTreeCheckpoint,
    enabled ? { machineId, workingDir: normalizedWorkingDir } : 'skip'
  ) as FileTreeCheckpoint | null | undefined;
  const checkpointRevision = checkpoint === undefined ? null : (checkpoint?.revision ?? 0);

  const manifest = useSessionQuery(
    api.workspaceFiles.getFileTreeManifestV3,
    enabled ? { machineId, workingDir: normalizedWorkingDir } : 'skip'
  ) as FileTreeManifestV3 | null | undefined;

  const useV3 =
    manifest != null &&
    manifest.complete === true &&
    (checkpoint === null || checkpoint?.snapshotKind === 'v3');
  const useV2 =
    checkpoint !== undefined &&
    !useV3 &&
    (checkpoint?.snapshotKind === 'v2' || (checkpoint === null && manifest === null));
  const manifestIncomplete = manifest != null && manifest.complete === false;

  const shardsRaw = useSessionQuery(
    api.workspaceFiles.getFileTreeShardsV3,
    enabled && useV3
      ? {
          machineId,
          workingDir: normalizedWorkingDir,
          syncGeneration: manifest.syncGeneration,
        }
      : 'skip'
  ) as FileTreeShardV3Row[] | null | undefined;

  const rawV2 = useSessionQuery(
    api.workspaceFiles.getFileTreeV2,
    enabled && useV2 ? { machineId, workingDir: normalizedWorkingDir } : 'skip'
  );
  const jsonV2 = useDecompressedQueryJson(rawV2, enabled && useV2);

  const parsedV2 = useMemo((): FileTree | null | undefined => {
    if (!enabled || !useV2) return undefined;
    if (rawV2 === undefined) return undefined;
    if (rawV2 === null) return null;
    if (jsonV2 === undefined) return undefined;
    if (jsonV2 === null) return null;
    try {
      return JSON.parse(jsonV2) as FileTree;
    } catch {
      return null;
    }
  }, [enabled, jsonV2, rawV2, useV2]);

  const [v3Entries, setV3Entries] = useState<FileTreeEntry[] | null | undefined>(undefined);

  const shardsPayloadKey = useMemo(() => {
    if (shardsRaw === undefined) return 'undefined';
    if (shardsRaw === null) return 'null';
    return shardsRaw.map((shard) => `${shard.shardId}:${shard.dataHash}`).join('|');
  }, [shardsRaw]);

  useEffect(() => {
    if (!enabled || !useV3 || !manifest || checkpointRevision === null) {
      setV3Entries(undefined);
      return;
    }
    if (shardsRaw === undefined) {
      setV3Entries(undefined);
      return;
    }
    if (shardsRaw === null) {
      setV3Entries(null);
      return;
    }

    let cancelled = false;
    setV3Entries(undefined);

    void (async () => {
      try {
        const payloads: FileTreeShardPayload[] = [];
        for (const shard of shardsRaw) {
          const json = await decompressGzip(shard.data.content);
          payloads.push(JSON.parse(json) as FileTreeShardPayload);
        }
        const entries = mergeFileTreeShardPayloads(payloads);
        if (!cancelled) {
          setV3Entries(entries);
          upsertWorkspaceFileTree(workspaceKey, entries, manifest.scannedAt, checkpointRevision);
        }
      } catch {
        if (!cancelled) setV3Entries(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkpointRevision, enabled, manifest, shardsPayloadKey, shardsRaw, useV3, workspaceKey]);

  useEffect(() => {
    if (!enabled || checkpointRevision === null || parsedV2 === undefined || parsedV2 === null) {
      return;
    }
    upsertWorkspaceFileTree(
      workspaceKey,
      parsedV2.entries,
      parsedV2.scannedAt ?? rawV2?.scannedAt ?? null,
      checkpointRevision
    );
  }, [checkpointRevision, enabled, parsedV2, rawV2?.scannedAt, workspaceKey]);

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

  const storeRevision = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeRevision(workspaceKey),
    () => getWorkspaceFileTreeRevision(workspaceKey)
  );

  const deltaResult = useSessionQuery(
    api.workspaceFiles.getFileTreeDeltas,
    enabled && storeRevision !== null
      ? {
          machineId,
          workingDir: normalizedWorkingDir,
          afterRevision: storeRevision,
        }
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
    [enabled, requestTree]
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

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  const resolvedEntries = resolveFileTreeEntries(storeEntries, v3Entries, parsedV2);

  const entries = useMemo(() => {
    if (!enabled) return EMPTY_FILE_ENTRIES;
    return fileTreeEntriesToFileEntries(resolvedEntries);
  }, [enabled, resolvedEntries]);

  const rootNodes = useMemo(() => {
    if (!enabled) return EMPTY_ROOT_NODES;
    return fileTreeEntriesToExplorerNodes(resolvedEntries);
  }, [enabled, resolvedEntries]);

  const scannedAt =
    storeScannedAt ?? manifest?.scannedAt ?? parsedV2?.scannedAt ?? rawV2?.scannedAt ?? null;
  const hasTree =
    storeRevision !== null ||
    storeEntries.length > 0 ||
    (v3Entries?.length ?? 0) > 0 ||
    (parsedV2?.entries?.length ?? 0) > 0;
  const v2Loading = useV2 && (rawV2 === undefined || (rawV2 !== null && jsonV2 === undefined));
  const v3Loading = useV3 && (shardsRaw === undefined || v3Entries === undefined);
  const isLoading =
    enabled && !hasTree && (manifest === undefined || manifestIncomplete || v3Loading || v2Loading);

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
