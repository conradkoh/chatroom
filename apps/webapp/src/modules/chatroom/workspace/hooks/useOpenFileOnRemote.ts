'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { WorkspaceGitState } from '@workspace/backend/src/domain/types/workspace-git';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { useWorkspaceGit } from './useWorkspaceGit';
import { buildRemoteFileUrl } from '../utils/remoteFileUrl';

import { toRepoHttpsUrl } from '@/lib/git-url';
import { openExternalUrl } from '@/lib/navigation';

type AvailableGitState = Extract<WorkspaceGitState, { status: 'available' }>;

type GitRefreshMutation = (args: { machineId: string; workingDir: string }) => Promise<unknown>;

async function syncGitInfo(
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string
): Promise<void> {
  try {
    await requestGitRefresh({ machineId, workingDir });
    toast.info('Syncing repository info — try again in a moment');
  } catch {
    toast.error('Failed to sync repository info');
  }
}

function getOriginRepoUrl(gitState: AvailableGitState): string | null {
  const origin = gitState.remotes.find((remote) => remote.name === 'origin');
  return origin ? toRepoHttpsUrl(origin.url) : null;
}

async function openAvailableGitFile(
  gitState: AvailableGitState,
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string,
  filePath: string,
  selection?: string
): Promise<void> {
  const repoUrl = getOriginRepoUrl(gitState);
  if (!repoUrl) {
    void requestGitRefresh({ machineId, workingDir }).catch(() => undefined);
    toast.error('No remote repository URL found for origin');
    return;
  }

  openExternalUrl(buildRemoteFileUrl(repoUrl, gitState.branch, filePath, selection));
}

async function openFileOnRemoteWithGitState(
  gitState: WorkspaceGitState,
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string,
  filePath: string,
  selection?: string
): Promise<void> {
  if (!machineId || !workingDir) {
    toast.error('No workspace connected');
    return;
  }

  if (gitState.status !== 'available') {
    await syncGitInfo(requestGitRefresh, machineId, workingDir);
    return;
  }

  await openAvailableGitFile(
    gitState,
    requestGitRefresh,
    machineId,
    workingDir,
    filePath,
    selection
  );
}

export function useOpenFileOnRemote(machineId: string, workingDir: string) {
  const gitState = useWorkspaceGit(machineId, workingDir);
  const requestGitRefresh = useSessionMutation(api.machines.requestGitRefresh);

  const openFileOnRemote = useCallback(
    (filePath: string, selection?: string) =>
      openFileOnRemoteWithGitState(
        gitState,
        requestGitRefresh,
        machineId,
        workingDir,
        filePath,
        selection
      ),
    [gitState, machineId, workingDir, requestGitRefresh]
  );

  return { openFileOnRemote };
}
