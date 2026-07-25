import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { completeActiveTasksForRole } from '../task/complete-active-tasks';

export async function completePlannerTasksOnEnhancerCheckIn(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_tasks'>[]> {
  return completeActiveTasksForRole(ctx, chatroomId, 'planner', { skipAutoPromotion: true });
}
