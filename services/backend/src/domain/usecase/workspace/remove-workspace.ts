/**
 * Use Case: Remove Workspace
 *
 * Soft-deletes a workspace by setting its `removedAt` timestamp.
 * The workspace record remains in the database for audit purposes.
 *
 * Also purges workspace-scoped data to prevent "ghost machines" — stale
 * references that point to a machine that is no longer associated with
 * the chatroom. This includes:
 * - chatroom_teamAgentConfigs (agent configs for this machine+chatroom)
 * - chatroom_workspaceGitState (git state for this workspace)
 * - chatroom_workspaceFileTree (file tree snapshots)
 * - chatroom_workspaceFileContent (cached file content)
 *
 * Throws if the workspace document does not exist.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RemoveWorkspaceInput {
  workspaceId: Id<'chatroom_workspaces'>;
}

// ─── Use Case ───────────────────────────────────────────────────────────────

export async function removeWorkspace(
  ctx: MutationCtx,
  input: RemoveWorkspaceInput
): Promise<void> {
  const workspace = await ctx.db.get(input.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${input.workspaceId}`);
  }

  // Soft-delete the workspace
  await ctx.db.patch(input.workspaceId, {
    removedAt: Date.now(),
  });

  // Purge workspace-scoped data to prevent ghost machines
  await purgeTeamAgentConfigsForMachine(
    ctx,
    workspace.chatroomId,
    workspace.machineId,
    input.workspaceId
  );
  await purgeWorkspaceScopedData(ctx, workspace.machineId, workspace.workingDir);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Purges `chatroom_teamAgentConfigs` entries for a machine+chatroom combination,
 * but only if no other active workspaces remain for that machine in the chatroom.
 *
 * This ensures we don't break multi-workspace setups where the same machine
 * has multiple workingDirs registered in a chatroom.
 *
 * @param ctx - Mutation context
 * @param chatroomId - The chatroom that the workspace belongs to
 * @param machineId - The machine whose configs should be purged
 * @param excludeWorkspaceId - The workspace being removed (already soft-deleted, exclude from active check)
 */
async function purgeTeamAgentConfigsForMachine(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  excludeWorkspaceId: Id<'chatroom_workspaces'>
): Promise<void> {
  // Check if any OTHER active workspaces remain for this machine+chatroom
  const otherActiveWorkspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .filter((q) =>
      q.and(
        q.eq(q.field('machineId'), machineId),
        q.eq(q.field('removedAt'), undefined),
        q.neq(q.field('_id'), excludeWorkspaceId)
      )
    )
    .first();

  if (otherActiveWorkspaces) {
    // Another active workspace exists for this machine+chatroom — keep the configs
    return;
  }

  // No other active workspaces — safe to purge configs for this machine
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .filter((q) => q.eq(q.field('machineId'), machineId))
    .collect();

  for (const config of configs) {
    await ctx.db.delete(config._id);
  }
}

/**
 * Purges workspace-scoped data for a machine+workingDir combination.
 *
 * This cleanup prevents ghost machine issues where stale workspace data
 * (git state, file trees, file content) could interfere with subsequent
 * workspace registrations or agent restarts.
 *
 * Tables cleaned up:
 * - chatroom_workspaceGitState (git state for this workspace)
 * - chatroom_workspaceFileTree (file tree snapshots)
 * - chatroom_workspaceFileContent (cached file content)
 *
 * @param ctx - Mutation context
 * @param machineId - The machine ID
 * @param workingDir - The working directory being removed
 */
async function purgeWorkspaceScopedData(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string
): Promise<void> {
  // Purge chatroom_workspaceGitState
  const gitStates = await ctx.db
    .query('chatroom_workspaceGitState')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .collect();
  for (const state of gitStates) {
    await ctx.db.delete(state._id);
  }

  // Purge chatroom_workspaceFileTree
  const fileTrees = await ctx.db
    .query('chatroom_workspaceFileTree')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .collect();
  for (const tree of fileTrees) {
    await ctx.db.delete(tree._id);
  }

  // Purge chatroom_workspaceFileContent
  const fileContents = await ctx.db
    .query('chatroom_workspaceFileContent')
    .withIndex('by_machine_workingDir_path', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .collect();
  for (const content of fileContents) {
    await ctx.db.delete(content._id);
  }
}
