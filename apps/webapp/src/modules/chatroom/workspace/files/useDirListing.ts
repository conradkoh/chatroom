'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

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
  const [parsed, setParsed] = useState<
    | {
        entries: DirListingEntry[];
        scannedAt: number;
        truncated: boolean;
      }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    if (!isActive) return;
    requestMutation({ machineId, workingDir, dirPath }).catch(() => {});
  }, [isActive, machineId, workingDir, dirPath, requestMutation]);

  useEffect(() => {
    if (!isActive) {
      setParsed(undefined);
      return;
    }
    if (raw === undefined) {
      setParsed(undefined);
      return;
    }
    if (raw === null) {
      setParsed(null);
      return;
    }

    let cancelled = false;
    decompressGzip(extractBase64Content(raw.data))
      .then((json) => {
        if (cancelled) return;
        const listing = JSON.parse(json) as {
          entries?: DirListingEntry[];
          truncated?: boolean;
        };
        setParsed({
          entries: listing.entries ?? [],
          scannedAt: raw.scannedAt,
          truncated: listing.truncated ?? raw.truncated,
        });
      })
      .catch(() => {
        if (!cancelled) setParsed(null);
      });
    return () => {
      cancelled = true;
    };
  }, [raw, isActive]);

  const refresh = useCallback(() => {
    if (!isActive) return;
    requestMutation({ machineId, workingDir, dirPath, force: true }).catch(() => {});
  }, [isActive, machineId, workingDir, dirPath, requestMutation]);

  if (!isActive) {
    return {
      entries: [],
      scannedAt: null,
      truncated: false,
      isLoading: false,
      refresh,
    };
  }

  return {
    entries: parsed?.entries ?? [],
    scannedAt: parsed?.scannedAt ?? null,
    truncated: parsed?.truncated ?? false,
    isLoading: parsed === undefined,
    refresh,
  };
}
