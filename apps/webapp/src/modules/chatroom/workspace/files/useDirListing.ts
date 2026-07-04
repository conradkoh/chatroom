'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo } from 'react';

import { useDecompressedQueryJson } from '../hooks/useDecompressedQueryJson';

const EMPTY_DIR_ENTRIES: DirListingEntry[] = [];

export interface UseDirListingArgs {
  machineId: string;
  workingDir: string;
  dirPath: string;
  enabled?: boolean;
}

// fallow-ignore-next-line complexity
export function useDirListing(args: UseDirListingArgs | 'skip'): {
  entries: DirListingEntry[];
  scannedAt: number | null;
  truncated: boolean;
  isLoading: boolean;
  refresh: () => void;
} {
  const requestMutation = useSessionMutation(api.workspaceFiles.requestDirListing);
  const isActive = args !== 'skip' && (args.enabled ?? true);
  const machineId = args !== 'skip' ? args.machineId : '';
  const workingDir = args !== 'skip' ? args.workingDir : '';
  const dirPath = args !== 'skip' ? args.dirPath : '';

  const queryArgs = isActive ? { machineId, workingDir, dirPath } : ('skip' as const);

  const raw = useSessionQuery(api.workspaceFiles.getDirListingV2, queryArgs);
  const json = useDecompressedQueryJson(raw, isActive);

  // fallow-ignore-next-line complexity
  const parsed = useMemo(() => {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (json === undefined) return undefined;
    if (json === null) return null;
    try {
      const listing = JSON.parse(json) as {
        entries?: DirListingEntry[];
        truncated?: boolean;
      };
      return {
        entries: listing.entries ?? EMPTY_DIR_ENTRIES,
        scannedAt: raw.scannedAt,
        truncated: listing.truncated ?? raw.truncated,
      };
    } catch {
      return null;
    }
  }, [json, raw]);

  useEffect(() => {
    if (!isActive) return;
    requestMutation({ machineId, workingDir, dirPath }).catch(() => {});
  }, [isActive, machineId, workingDir, dirPath, requestMutation]);

  const refresh = useCallback(() => {
    if (!isActive) return;
    requestMutation({ machineId, workingDir, dirPath, force: true }).catch(() => {});
  }, [isActive, machineId, workingDir, dirPath, requestMutation]);

  const entries = isActive ? (parsed?.entries ?? EMPTY_DIR_ENTRIES) : EMPTY_DIR_ENTRIES;
  const isLoading = isActive && parsed === undefined;

  return useMemo(
    // fallow-ignore-next-line complexity
    () => ({
      entries,
      scannedAt: parsed?.scannedAt ?? null,
      truncated: parsed?.truncated ?? false,
      isLoading,
      refresh,
    }),
    [entries, parsed?.scannedAt, parsed?.truncated, isLoading, refresh]
  );
}
