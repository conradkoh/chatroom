import type { QueryCtx } from '../../../../convex/_generated/server';
import { getActiveTeamStructure } from '../team/active-team-structure';

/** Confirms this machine currently hosts the task's assigned remote role. */
// fallow-ignore-next-line complexity
export async function isTaskRoutedToMachine(
  ctx: QueryCtx,
  task: { chatroomId: string; assignedTo?: string },
  machineId: string
): Promise<boolean> {
  const role = task.assignedTo?.trim().toLowerCase();
  if (!role) return false;
  const requests = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  for (const request of requests) {
    if (
      request.agentType === 'remote' &&
      request.chatroomId === task.chatroomId &&
      request.role.trim().toLowerCase() === role
    ) {
      const structure = await getActiveTeamStructure(ctx, request.chatroomId);
      if (structure?.teamStructureId === request.teamStructureId) return true;
    }
  }
  return false;
}
