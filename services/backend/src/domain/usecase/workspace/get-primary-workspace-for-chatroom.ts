import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = QueryCtx | MutationCtx;

/** Resolve the chatroom's active workspace without making callers choose one. */
export async function getPrimaryWorkspaceForChatroom(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  options?: { fallbackToNewest?: boolean }
): Promise<Doc<'chatroom_workspaces'> | null> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const active = workspaces.filter((workspace) => workspace.removedAt === undefined);
  if (active.length === 0) return null;

  const selection = await ctx.db
    .query('chatroom_primaryWorkspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  const selected = selection
    ? active.find((workspace) => workspace._id === selection.workspaceId)
    : undefined;

  if (!selected && options?.fallbackToNewest === false) return null;

  // Preserve the existing deterministic fallback for chatrooms created before
  // primary workspace selection was introduced.
  return selected ?? active.slice().sort((a, b) => b.registeredAt - a.registeredAt)[0] ?? null;
}
