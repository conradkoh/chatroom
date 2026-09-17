import type { Doc, Id } from '../../../convex/_generated/dataModel';
import type { QueryCtx, MutationCtx } from '../../../convex/_generated/server';
import type { TaskStatus } from '../../../convex/lib/taskStateMachine';

/**
 * Loads every task of one chatroom currently in a given status (chatroom +
 * status index lookup). Shared by the in-flight task release and
 * find-acknowledged usecases.
 */
export async function listChatroomTasksByStatus<TCtx extends QueryCtx | MutationCtx>(
  ctx: TCtx,
  chatroomId: Id<'chatroom_rooms'>,
  status: TaskStatus
): Promise<Doc<'chatroom_tasks'>[]> {
  return ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId).eq('status', status))
    .collect();
}
