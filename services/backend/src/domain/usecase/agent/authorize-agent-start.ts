import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export type AuthorizeAgentStartArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  taskId?: Id<'chatroom_tasks'> | undefined;
};
export type AuthorizeAgentStartReason =
  'stopped' | 'disabled' | 'not_configured' | 'no_active_task';
export type AuthorizeAgentStartResult =
  { allowed: true } | { allowed: false; reason: AuthorizeAgentStartReason };

export async function authorizeAgentStart(
  ctx: MutationCtx,
  args: AuthorizeAgentStartArgs
): Promise<AuthorizeAgentStartResult> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room?.teamId) return { allowed: false, reason: 'not_configured' };
  const teamId = room.teamId;
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, args.role))
    )
    .first();
  if (!config || config.machineId !== args.machineId)
    return { allowed: false, reason: 'not_configured' };
  if (config.enabled === false) return { allowed: false, reason: 'disabled' };
  if (config.desiredState === 'stopped') return { allowed: false, reason: 'stopped' };
  if (isEphemeralAgentRole(args.role)) {
    const task = args.taskId ? await ctx.db.get('chatroom_tasks', args.taskId) : null;
    if (
      !task ||
      task.chatroomId !== args.chatroomId ||
      task.assignedTo?.toLowerCase() !== args.role.toLowerCase() ||
      !['pending', 'acknowledged', 'in_progress'].includes(task.status)
    )
      return { allowed: false, reason: 'no_active_task' };
  }
  return { allowed: true };
}
