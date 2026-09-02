'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { FILE_TREE_WATCH_RENEW_INTERVAL_MS } from '@workspace/backend/src/domain/constants/workspace-file-tree-watch';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useRef } from 'react';

import {
  acquireFileTreeWatch,
  releaseFileTreeWatch,
  renewFileTreeWatchLease,
} from './workspaceFileTreeWatchCoordinator';

export function useFileTreeWatchLease(
  machineId: string | null | undefined,
  workingDir: string | null | undefined,
  active: boolean
): void {
  const adjustWatch = useSessionMutation(api.workspaceFiles.adjustFileTreeWatch);
  const renewMutation = useSessionMutation(api.workspaceFiles.renewFileTreeWatchLease);
  const renewRef = useRef(renewMutation);
  renewRef.current = renewMutation;

  useEffect(() => {
    if (!active || !machineId?.trim() || !workingDir?.trim()) return;

    acquireFileTreeWatch(machineId, workingDir, adjustWatch);
    const renew = () =>
      renewFileTreeWatchLease(machineId, workingDir, (args) => renewRef.current(args));

    renew();
    const intervalId = window.setInterval(renew, FILE_TREE_WATCH_RENEW_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      releaseFileTreeWatch(machineId, workingDir, adjustWatch);
    };
  }, [active, machineId, workingDir, adjustWatch]);
}
