import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Points a brand-new chatroom at its first workspace. Writes the row directly: the
 * session-authenticated setPrimaryWorkspaceForChatroom mutation is not usable at creation time.
 */
export async function insertInitialPrimaryWorkspace(
  ctx: MutationCtx,
  a: { chatroomId: Id<'chatroom_rooms'>; workspaceId: Id<'chatroom_workspaces'> }
): Promise<void> {
  await ctx.db.insert('chatroom_primaryWorkspaces', {
    chatroomId: a.chatroomId,
    workspaceId: a.workspaceId,
    updatedAt: Date.now(),
  });
}
