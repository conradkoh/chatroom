import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Makes `workspaceId` the chatroom's primary workspace pointer: patches the single
 * `chatroom_primaryWorkspaces` row for the chatroom, or inserts it. Callers validate
 * that the workspace is active in the chatroom before calling.
 */
export async function setPrimaryWorkspaceSelection(
  ctx: MutationCtx,
  a: { chatroomId: Id<'chatroom_rooms'>; workspaceId: Id<'chatroom_workspaces'> }
): Promise<Id<'chatroom_primaryWorkspaces'>> {
  const existing = await ctx.db
    .query('chatroom_primaryWorkspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', a.chatroomId))
    .first();
  const selection = { chatroomId: a.chatroomId, workspaceId: a.workspaceId, updatedAt: Date.now() };
  if (existing) {
    await ctx.db.patch('chatroom_primaryWorkspaces', existing._id, selection);
    return existing._id;
  }
  return ctx.db.insert('chatroom_primaryWorkspaces', selection);
}
