/**
 * Use Case: Remove Workspace
 *
 * Soft-deletes a workspace by setting its `removedAt` timestamp.
 * The workspace record remains in the database for audit purposes.
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

  await ctx.db.patch(input.workspaceId, {
    removedAt: Date.now(),
  });
}
