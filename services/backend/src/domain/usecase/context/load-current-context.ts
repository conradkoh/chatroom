/**
 * Shared loader for the currently pinned context of a chatroom.
 *
 * Staleness is purely time-based: callers read `elapsedHours` and apply their
 * own thresholds. There are no message-doc reads here, so this helper is O(1)
 * regardless of chatroom message volume.
 *
 * Returned shape is the union used by the get-next-task prompt, the CLI
 * task-read renderer, and the inspect-context CLI command — keep these
 * fields stable.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx, MutationCtx } from '../../../../convex/_generated/server';

export interface CurrentContextSnapshot {
  _id: string;
  content: string;
  createdBy: string;
  createdAt: number;
  /** Hours elapsed since the context was created. Drives staleness banners. */
  elapsedHours: number;
}

/**
 * Loads the chatroom's currently pinned context with time-based staleness.
 * Returns `null` if the chatroom is missing, has no pinned context, or the
 * referenced context record cannot be found.
 */
export async function loadCurrentContext(
  ctx: { db: QueryCtx['db'] | MutationCtx['db'] },
  chatroomId: Id<'chatroom_rooms'>
): Promise<CurrentContextSnapshot | null> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.currentContextId) {
    return null;
  }

  const context = await ctx.db.get('chatroom_contexts', chatroom.currentContextId);
  if (!context) {
    return null;
  }

  const elapsedMs = Date.now() - context.createdAt;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  return {
    _id: context._id,
    content: context.content,
    createdBy: context.createdBy,
    createdAt: context.createdAt,
    elapsedHours,
  };
}
