'use client';
// fallow-ignore-file code-duplication

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useSyncExternalStore } from 'react';

import {
  acquireFileTreeWatch,
  isFileTreeWatchActive,
  releaseFileTreeWatch,
  subscribeFileTreeWatch,
} from './workspaceFileTreeWatchCoordinator';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export function useFileTreeWatchEnabled(machineId: string, workingDir: string): boolean {
  const normalized = normalizeWorkspaceWorkingDir(workingDir);
  return useSyncExternalStore(
    subscribeFileTreeWatch,
    () => isFileTreeWatchActive(machineId, normalized),
    () => false
  );
}

/**
 * Acquires a file-tree watch while `active` (explorer, file picker, @ autocomplete).
 */
// fallow-ignore-next-line unused-export
export function useAcquireFileTreeWatch(
  machineId: string | null | undefined,
  workingDir: string | null | undefined,
  active: boolean
): void {
  const adjustWatch = useSessionMutation(api.workspaceFiles.adjustFileTreeWatch);

  useEffect(() => {
    if (!active || !machineId?.trim() || !workingDir?.trim()) return;

    acquireFileTreeWatch(machineId, workingDir, adjustWatch);
    return () => releaseFileTreeWatch(machineId, workingDir, adjustWatch);
  }, [active, machineId, workingDir, adjustWatch]);
}
