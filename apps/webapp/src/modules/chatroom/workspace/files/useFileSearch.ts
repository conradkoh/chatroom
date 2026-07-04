'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo } from 'react';

import { isFileSearchQueryActive } from './explorer-tree';
import { useDecompressedQueryJson } from '../hooks/useDecompressedQueryJson';

// fallow-ignore-next-line complexity
export function useFileSearch(
  args: { machineId: string; workingDir: string; query: string; enabled?: boolean } | 'skip'
): {
  entries: { path: string; type: 'file' }[];
  isLoading: boolean;
  refresh: () => void;
} {
  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileSearch);
  const isActive = args !== 'skip' && (args.enabled ?? true);
  const machineId = args !== 'skip' ? args.machineId : '';
  const workingDir = args !== 'skip' ? args.workingDir : '';
  const trimmedQuery = args !== 'skip' ? args.query.trim() : '';
  const queryActive = isFileSearchQueryActive(trimmedQuery);
  const searchEnabled = isActive && queryActive;

  const queryArgs = searchEnabled
    ? { machineId, workingDir, query: trimmedQuery }
    : ('skip' as const);

  const raw = useSessionQuery(api.workspaceFiles.getFileSearchV2, queryArgs);
  const json = useDecompressedQueryJson(raw, searchEnabled);

  // fallow-ignore-next-line complexity
  const { entries, isParsed } = useMemo(() => {
    if (!searchEnabled) return { entries: [], isParsed: true };
    if (raw === undefined) return { entries: [], isParsed: false };
    if (raw === null) return { entries: [], isParsed: true };
    if (raw !== undefined && raw !== null && json === null) {
      return { entries: [], isParsed: false };
    }
    if (json === undefined) return { entries: [], isParsed: false };
    if (json === null) return { entries: [], isParsed: true };
    try {
      const result = JSON.parse(json) as {
        entries?: { path: string; type: 'file' }[];
      };
      return { entries: result.entries ?? [], isParsed: true };
    } catch {
      return { entries: [], isParsed: true };
    }
  }, [json, searchEnabled, raw]);

  useEffect(() => {
    if (!searchEnabled) return;
    requestMutation({ machineId, workingDir, query: trimmedQuery }).catch(() => {});
  }, [searchEnabled, machineId, workingDir, trimmedQuery, requestMutation]);

  const refresh = useCallback(() => {
    if (!searchEnabled) return;
    requestMutation({ machineId, workingDir, query: trimmedQuery, force: true }).catch(() => {});
  }, [searchEnabled, machineId, workingDir, trimmedQuery, requestMutation]);

  return {
    entries: searchEnabled ? entries : [],
    isLoading: searchEnabled && !isParsed,
    refresh,
  };
}
