/**
 * Workspace-scoped authentication and authorization helpers.
 *
 * Workspaces are protected via machine ownership — a user may access a workspace
 * if they have the corresponding permission on the machine it belongs to.
 *
 * ## Naming convention
 * - `requireWorkspaceOwner`       — session + machine owner permission; fail-closed.
 * - `requireWorkspaceWriteAccess` — session + machine write-access permission; fail-closed.
 */

import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { requireMachineOwner, requireMachineWriteAccess } from './machineAccess';

/** Auth result for workspace-scoped operations. */
export type WorkspaceAuth = {
  userId: Id<'users'>;
  workspace: Doc<'chatroom_workspaces'>;
};

async function loadWorkspace(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<Doc<'chatroom_workspaces'>> {
  const workspace = await ctx.db.get('chatroom_workspaces', workspaceId);
  if (!workspace) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
  return workspace;
}

/**
 * Require that the session user owns the machine this workspace belongs to.
 * Use for workspace mutations that require full ownership.
 */
export async function requireWorkspaceOwner(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<WorkspaceAuth> {
  const workspace = await loadWorkspace(ctx, workspaceId);
  const auth = await requireMachineOwner(ctx, sessionId, workspace.machineId);
  return { userId: auth.userId, workspace };
}

/**
 * Require that the session user has write-access to the machine this workspace belongs to.
 * Use for workspace mutations that allow collaborators (write-access, not just owner).
 */
export async function requireWorkspaceWriteAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  workspaceId: Id<'chatroom_workspaces'>
): Promise<WorkspaceAuth> {
  const workspace = await loadWorkspace(ctx, workspaceId);
  const auth = await requireMachineWriteAccess(ctx, sessionId, workspace.machineId);
  return { userId: auth.userId, workspace };
}
