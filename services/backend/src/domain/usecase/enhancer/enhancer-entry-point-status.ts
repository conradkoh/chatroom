import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import {
  findActiveEnhancerJob,
  findActiveEnhancerJobForChatroom,
} from '../../../../convex/web/enhancer/jobHelpers';
import { transitionAgentStatus } from '../agent/transition-agent-status';

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
  await transitionAgentStatus(ctx, chatroomId, entryPointRole, 'agent.enhancing');
}

/** Clear the entry-point agent's enhancing status after the advisory pass ends. */
export async function transitionEnhancerEntryPointToWaiting(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<void> {
  await transitionAgentStatus(ctx, chatroomId, entryPointRole, 'agent.waiting');
}

export async function hasActiveEntryPointEnhancerJob(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<boolean> {
  const active = await findActiveEnhancerJob(ctx, chatroomId, entryPointRole, 'enhancer');
  return active !== null;
}

/** True while an enhancer job or enhancer task row is in flight. */
export async function hasActiveEnhancerWork(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  if (await findActiveEnhancerJobForChatroom(ctx, chatroomId)) {
    return true;
  }
  return hasActiveEnhancerTask(ctx, chatroomId);
}
