/**
 * Use Case: Register Workspace
 *
 * Upserts a workspace registration for a (chatroomId, machineId, workingDir) triple.
 *
 * Behavior:
 *   - If no record exists → insert a new active workspace
 *   - If a record exists and is active → no-op (return existing ID)
 *   - If a record exists and is removed → reactivate it (clear removedAt)
 *
 * Returns the workspace document ID.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { WorkspaceRegistration } from '../../entities/workspace';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RegisterWorkspaceInput = WorkspaceRegistration;

export type RegisterWorkspaceResult = Id<'chatroom_workspaces'>;

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function registerWorkspace(
  ctx: MutationCtx,
  input: RegisterWorkspaceInput
): Promise<RegisterWorkspaceResult> {
  const { chatroomId, machineId, workingDir, hostname, registeredBy } = input;

  // Look up existing workspace by the unique triple
  const existing = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom_machine_workingDir', (q) =>
      q
        .eq('chatroomId', chatroomId as Id<'chatroom_rooms'>)
        .eq('machineId', machineId)
        .eq('workingDir', workingDir)
    )
    .first();

  if (existing) {
    if (existing.removedAt !== undefined) {
      // Reactivate soft-deleted workspace
      await ctx.db.patch(existing._id, {
        removedAt: undefined,
        hostname,
        registeredBy,
        registeredAt: Date.now(),
      });
    }
    // If active, no-op — return existing ID
    return existing._id;
  }

  // Insert new workspace record
  const id = await ctx.db.insert('chatroom_workspaces', {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    machineId,
    workingDir,
    hostname,
    registeredBy,
    registeredAt: Date.now(),
  });

  return id;
}
