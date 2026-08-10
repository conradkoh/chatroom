/**
 * Use Case: Create Workspace (user-owned, unassigned)
 *
 * Creates a workspace record owned by a user that is not bound to any chatroom.
 * An unassigned row has `userId` set and no `chatroomId`. Daemon/chatroom
 * registrations (registerWorkspace) are intentionally left unchanged.
 *
 * Enforces an active machine+normalized-workingDir conflict check across all
 * workspace rows (chatroom-bound or not) using the shared `by_machine_workingDir`
 * index. A soft-deleted row does not block a fresh create.
 */

import { ConvexError } from 'convex/values';

import { BACKEND_ERROR_CODES } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import { isActiveWorkspace } from '../../entities/workspace';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateWorkspaceInput {
  userId: Id<'users'>;
  machineId: string;
  workingDir: string;
  hostname: string;
}

export type CreateWorkspaceResult = Id<'chatroom_workspaces'>;

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function createWorkspace(
  ctx: MutationCtx,
  input: CreateWorkspaceInput
): Promise<CreateWorkspaceResult> {
  const normalizedWorkingDir = normalizeWorkingDir(input.workingDir);

  // Reject an active duplicate of the same machine + normalized working dir.
  const existing = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', input.machineId).eq('workingDir', normalizedWorkingDir)
    )
    .first();

  if (existing && isActiveWorkspace(existing.removedAt)) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.CONFLICT,
      message: 'A workspace already exists on this machine for that folder',
      fields: ['machineId', 'workingDir'],
    });
  }

  return ctx.db.insert('chatroom_workspaces', {
    userId: input.userId,
    machineId: input.machineId,
    workingDir: normalizedWorkingDir,
    hostname: input.hostname,
    registeredAt: Date.now(),
    registeredBy: 'user',
  });
}
