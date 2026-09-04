import { ConvexError } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { normalizeWorkingDir } from '../workspacePathSecurity';

export const FILE_TREE_SYNC_DISABLED_CODE = 'FILE_TREE_SYNC_DISABLED' as const;

export function isFileTreeSyncEnabled(
  workspace: Pick<Doc<'chatroom_workspaces'>, 'fileTreeSyncEnabled' | 'removedAt'>
): boolean {
  if (workspace.removedAt !== undefined) return false;
  return workspace.fileTreeSyncEnabled === true;
}

// The indexed lookup intentionally mirrors workspacePathSecurity's registration check.
// fallow-ignore-next-line complexity code-duplication
async function findActiveWorkspaceForMachinePath(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
): Promise<Doc<'chatroom_workspaces'> | null> {
  const normalizedWorkingDir = normalizeWorkingDir(workingDir);
  let workspace = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', normalizedWorkingDir)
    )
    .first();

  if (!workspace && normalizedWorkingDir !== workingDir.trim()) {
    workspace = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', machineId).eq('workingDir', workingDir.trim())
      )
      .first();
  }

  if (!workspace || workspace.removedAt !== undefined) return null;
  return workspace;
}

/** Throws ConvexError(FILE_TREE_SYNC_DISABLED) unless sync is explicitly enabled. */
export async function requireFileTreeSyncEnabledForWorkspace(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  workingDir: string
): Promise<Doc<'chatroom_workspaces'>> {
  const workspace = await findActiveWorkspaceForMachinePath(ctx, machineId, workingDir);
  if (!workspace || !isFileTreeSyncEnabled(workspace)) {
    throw new ConvexError({
      code: FILE_TREE_SYNC_DISABLED_CODE,
      message: 'File tree sync is disabled for this workspace',
    });
  }
  return workspace;
}
