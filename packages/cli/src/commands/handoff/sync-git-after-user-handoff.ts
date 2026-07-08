import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  DiffStat,
  WorkspaceGitState,
} from '@workspace/backend/src/domain/types/workspace-git';

import type { HandoffDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import * as gitReader from '../../infrastructure/git/git-reader.js';
import { getMachineId } from '../../infrastructure/machine/index.js';

interface WorkspaceForChatroom {
  machineId: string;
  workingDir: string;
}

function diffStatEqual(a: DiffStat, b: DiffStat): boolean {
  return (
    a.filesChanged === b.filesChanged &&
    a.insertions === b.insertions &&
    a.deletions === b.deletions
  );
}

async function resolvePath(path: string): Promise<string> {
  try {
    return await realpath(resolve(path));
  } catch {
    return resolve(path);
  }
}

async function findWorkspaceForCwd(
  deps: HandoffDeps,
  sessionId: string,
  chatroomId: string
): Promise<WorkspaceForChatroom | null> {
  const cwd = await resolvePath(process.cwd());
  const workspaces = (await deps.backend.query(api.workspaces.listWorkspacesForChatroom, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as WorkspaceForChatroom[];

  for (const workspace of workspaces) {
    if ((await resolvePath(workspace.workingDir)) === cwd) {
      return workspace;
    }
  }

  return null;
}

function gitInfoChanged(
  local: {
    branch: string;
    isDirty: boolean;
    diffStat: DiffStat;
  },
  remote: Extract<WorkspaceGitState, { status: 'available' }>
): boolean {
  return (
    remote.branch !== local.branch ||
    remote.isDirty !== local.isDirty ||
    !diffStatEqual(remote.diffStat, local.diffStat)
  );
}

async function readLocalGitSnapshot(workingDir: string): Promise<{
  branch: string;
  isDirty: boolean;
  diffStat: DiffStat;
} | null> {
  const branchResult = await gitReader.getBranch(workingDir);
  if (branchResult.status !== 'available') return null;

  const isDirty = await gitReader.isDirty(workingDir);
  const diffStatResult = await gitReader.getDiffStat(workingDir);
  const diffStat =
    diffStatResult.status === 'available'
      ? diffStatResult.diffStat
      : { filesChanged: 0, insertions: 0, deletions: 0 };

  return { branch: branchResult.branch, isDirty, diffStat };
}

/**
 * After a successful handoff to `user`, compare local git state with the last
 * daemon push and request a refresh when branch or diff info has changed.
 */
// fallow-ignore-next-line complexity
export async function syncGitAfterUserHandoff(
  deps: HandoffDeps,
  sessionId: string,
  chatroomId: string,
  nextRole: string
): Promise<void> {
  if (nextRole !== 'user') return;

  try {
    const machineId = await getMachineId();
    if (!machineId) return;

    const workspace = await findWorkspaceForCwd(deps, sessionId, chatroomId);
    if (!workspace || workspace.machineId !== machineId) return;

    const local = await readLocalGitSnapshot(workspace.workingDir);
    if (!local) return;

    const remote = (await deps.backend.query(api.workspaces.getWorkspaceGitState, {
      sessionId,
      machineId: workspace.machineId,
      workingDir: workspace.workingDir,
    })) as WorkspaceGitState;

    const needsRefresh = remote.status !== 'available' || gitInfoChanged(local, remote);
    if (!needsRefresh) return;

    await deps.backend.mutation(api.machines.requestGitRefresh, {
      sessionId,
      machineId: workspace.machineId,
      workingDir: workspace.workingDir,
    });
  } catch (error) {
    if (process.env.CHATROOM_DEBUG === 'true') {
      console.error('[handoff] git sync after user handoff failed:', error);
    }
  }
}
