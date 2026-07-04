'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useMemo } from 'react';

export interface UseDirListingWatchArgs {
  machineId: string;
  workingDir: string;
  /** Hot dir paths: must include '' for root plus expanded folder paths. */
  activeDirPaths: string[];
  enabled?: boolean;
}

/**
 * Registers explorer presence and active dir paths with the backend watch registry.
 * Daemon uses this (slice 3) to scope FS watchers to hot directories.
 */
export function useDirListingWatch({
  machineId,
  workingDir,
  activeDirPaths,
  enabled = true,
}: UseDirListingWatchArgs): void {
  const observeMutation = useSessionMutation(api.workspaceFiles.setDirListingExplorerObserver);
  const pathsMutation = useSessionMutation(api.workspaceFiles.setDirListingWatchPaths);

  const isActive = enabled && !!machineId && !!workingDir;
  const pathsKey = useMemo(() => activeDirPaths.join('\0'), [activeDirPaths]);

  useEffect(() => {
    if (!isActive) return;
    observeMutation({ machineId, workingDir, observing: true }).catch(() => {});
    return () => {
      observeMutation({ machineId, workingDir, observing: false }).catch(() => {});
    };
  }, [isActive, machineId, workingDir, observeMutation]);

  useEffect(() => {
    if (!isActive) return;
    pathsMutation({ machineId, workingDir, activeDirPaths }).catch(() => {});
  }, [isActive, machineId, workingDir, pathsKey, activeDirPaths, pathsMutation]);
}
