'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

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
  const queryActive = trimmedQuery === '' || trimmedQuery.length >= 2;
  const searchEnabled = isActive && queryActive;

  const queryArgs = searchEnabled
    ? { machineId, workingDir, query: trimmedQuery }
    : ('skip' as const);

  const raw = useSessionQuery(api.workspaceFiles.getFileSearchV2, queryArgs);
  const [entries, setEntries] = useState<{ path: string; type: 'file' }[]>([]);
  const [isParsed, setIsParsed] = useState(false);

  useEffect(() => {
    if (!searchEnabled) {
      setEntries([]);
      setIsParsed(true);
      return;
    }
    requestMutation({ machineId, workingDir, query: trimmedQuery }).catch(() => {});
  }, [searchEnabled, machineId, workingDir, trimmedQuery, requestMutation]);

  useEffect(() => {
    if (!searchEnabled) return;
    if (raw === undefined) {
      setIsParsed(false);
      return;
    }
    if (raw === null) {
      setEntries([]);
      setIsParsed(true);
      return;
    }

    let cancelled = false;
    decompressGzip(extractBase64Content(raw.data))
      .then((json) => {
        if (cancelled) return;
        const result = JSON.parse(json) as {
          entries?: { path: string; type: 'file' }[];
        };
        setEntries(result.entries ?? []);
        setIsParsed(true);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setIsParsed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [raw, searchEnabled]);

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
