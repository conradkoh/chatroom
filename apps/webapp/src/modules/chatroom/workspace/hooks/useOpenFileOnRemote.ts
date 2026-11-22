'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { WorkspaceGitState } from '@workspace/backend/src/domain/types/workspace-git';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { useWorkspaceGit } from './useWorkspaceGit';
import { buildRemoteFileUrl } from '../utils/remoteFileUrl';

import { toRepoHttpsUrl } from '@/lib/git-url';
import { openExternalUrl } from '@/lib/navigation';

type AvailableGitState = Extract<WorkspaceGitState, { status: 'available' }>;

type GitRefreshMutation = (args: { machineId: string; workingDir: string }) => Promise<unknown>;

/** What one open-on-remote attempt produced. `syncing` is info; `error` is an alert. */
export type OpenFileOnRemoteOutcome =
  { status: 'ok' } | { status: 'syncing'; message: string } | { status: 'error'; message: string };

const NO_WORKSPACE_MESSAGE = 'No workspace connected';
const SYNCING_MESSAGE = 'Syncing repository info — try again in a moment';
const SYNC_FAILED_MESSAGE = 'Failed to sync repository info';
const NO_ORIGIN_MESSAGE = 'No remote repository URL found for origin';

async function syncGitInfo(
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string
): Promise<OpenFileOnRemoteOutcome> {
  try {
    await requestGitRefresh({ machineId, workingDir });
    return { status: 'syncing', message: SYNCING_MESSAGE };
  } catch {
    return { status: 'error', message: SYNC_FAILED_MESSAGE };
  }
}

function getOriginRepoUrl(gitState: AvailableGitState): string | null {
  const origin = gitState.remotes.find((remote) => remote.name === 'origin');
  return origin ? toRepoHttpsUrl(origin.url) : null;
}

function openAvailableGitFile(
  gitState: AvailableGitState,
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string,
  filePath: string,
  selection?: string
): OpenFileOnRemoteOutcome {
  const repoUrl = getOriginRepoUrl(gitState);
  if (!repoUrl) {
    void requestGitRefresh({ machineId, workingDir }).catch(() => undefined);
    return { status: 'error', message: NO_ORIGIN_MESSAGE };
  }

  openExternalUrl(buildRemoteFileUrl(repoUrl, gitState.branch, filePath, selection));
  return { status: 'ok' };
}

async function openFileOnRemoteWithGitState(
  gitState: WorkspaceGitState,
  requestGitRefresh: GitRefreshMutation,
  machineId: string,
  workingDir: string,
  filePath: string,
  selection?: string
): Promise<OpenFileOnRemoteOutcome> {
  if (!machineId || !workingDir) {
    return { status: 'error', message: NO_WORKSPACE_MESSAGE };
  }

  if (gitState.status !== 'available') {
    return syncGitInfo(requestGitRefresh, machineId, workingDir);
  }

  return openAvailableGitFile(
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
    (filePath: string, selection?: string): Promise<OpenFileOnRemoteOutcome> =>
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
