/**
 * Use Case: Remove Workspace
 *
 * Soft-deletes a workspace by setting its `removedAt` timestamp.
 * The workspace record remains in the database for audit purposes.
 *
 * Also purges `chatroom_teamAgentConfigs` entries for the workspace's machine+chatroom
 * combination to prevent "ghost machines" — stale config references that point to
 * a machine that is no longer associated with the chatroom.
 *
 * Throws if the workspace document does not exist.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RemoveWorkspaceInput {
  workspaceId: Id<'chatroom_workspaces'>;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

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

  // Purge teamAgentConfigs for this machine+chatroom to prevent ghost machines
  await purgeTeamAgentConfigsForMachine(ctx, workspace.chatroomId, workspace.machineId, input.workspaceId);
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
