import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

async function hasActiveEnhancerTask(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  for (const status of ACTIVE_TASK_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', status).eq('assignedTo', 'enhancer')
      )
      .first();
    if (tasks) return true;
  }
  return false;
}

/** Set the persistent entry-point agent's status while enhancer work is in flight. */
export async function transitionEnhancerEntryPointToEnhancing(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<void> {
  // Enhancer work is reported by the daemon status outbox. Backend job/task
  // mutations must not infer an agent lifecycle state.
  void ctx;
  void chatroomId;
  void entryPointRole;
}

/** Clear the entry-point agent's enhancing status after the advisory pass ends. */
export async function transitionEnhancerEntryPointToWaiting(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<void> {
  void ctx;
  void chatroomId;
  void entryPointRole;
}

export async function hasActiveEntryPointEnhancerJob(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  return hasActiveEnhancerTask(ctx, chatroomId);
}

/** True while an enhancer task row is in flight. */
export async function hasActiveEnhancerWork(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  return hasActiveEnhancerTask(ctx, chatroomId);
}
