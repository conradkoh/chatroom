import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

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
  if (!room) return { allowed: false, reason: 'not_configured' };
  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
  if (!launchRequest || launchRequest.machineId !== args.machineId)
    return { allowed: false, reason: 'not_configured' };
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
