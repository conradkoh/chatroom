import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export type AuthorizeAgentStartArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  lifecycleRevision?: number;
  taskId?: Id<'chatroom_tasks'>;
};
export type AuthorizeAgentStartReason =
  | 'stale_revision'
  | 'stopped'
  | 'disabled'
  | 'stop_in_flight'
  | 'not_configured'
  | 'no_active_task';
export type AuthorizeAgentStartResult =
  | { allowed: true; lifecycleRevision: number }
  | { allowed: false; reason: AuthorizeAgentStartReason };

async function hasInflightStop(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  for (const scopeKey of ['chatroom', `agent:${role.trim().toLowerCase()}`]) {
    for (const status of ['pending', 'processing'] as const) {
      const command = await ctx.db
        .query('chatroom_agentStopCommands')
        .withIndex('by_chatroom_scopeKey_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('scopeKey', scopeKey).eq('status', status)
        )
        .first();
      if (command) return true;
    }
  }
  return false;
}

export async function authorizeAgentStart(
  ctx: MutationCtx,
  args: AuthorizeAgentStartArgs
): Promise<AuthorizeAgentStartResult> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room?.teamId) return { allowed: false, reason: 'not_configured' };
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, room.teamId!, args.role))
    )
    .first();
  if (!config || config.machineId !== args.machineId)
    return { allowed: false, reason: 'not_configured' };
  const currentRevision = config.lifecycleRevision ?? 0;
  if (args.lifecycleRevision !== undefined && args.lifecycleRevision !== currentRevision)
    return { allowed: false, reason: 'stale_revision' };
  if (config.enabled === false) return { allowed: false, reason: 'disabled' };
  if (config.desiredState === 'stopped') return { allowed: false, reason: 'stopped' };
  if (await hasInflightStop(ctx, args.chatroomId, args.role))
    return { allowed: false, reason: 'stop_in_flight' };
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
  return { allowed: true, lifecycleRevision: currentRevision };
}
