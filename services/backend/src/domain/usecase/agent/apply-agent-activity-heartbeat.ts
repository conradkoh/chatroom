import { touchAgentRoleStatusLastSeen } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { NATIVE_TASK_INJECTED_ACTION, NATIVE_WAITING_ACTION } from '../../entities/participant';
import { hasActiveEntryPointEnhancerJob } from '../enhancer/enhancer-entry-point-status';
import {
  findActiveAssignedTaskForRole,
  findAcknowledgedTaskForRole,
} from '../task/find-acknowledged-task-for-role';

export async function applyAgentActivityHeartbeat(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    action: string;
    taskId?: Id<'chatroom_tasks'> | undefined;
    participantId?: Id<'chatroom_participants'> | undefined;
    emittedAt?: number | undefined;
  }
): Promise<void> {
  await touchAgentRoleStatusLastSeen(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    lastSeenAt: args.emittedAt ?? Date.now(),
  });
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const teamId = room?.teamId;
  const config = teamId
    ? await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, args.role))
        )
        .first()
    : null;
  const stopped = config?.desiredState === 'stopped';
  if (args.action === 'get-next-task:started' && !stopped) {
    const enhancing = await hasActiveEntryPointEnhancerJob(ctx, args.chatroomId, args.role);
    await transitionAgentStatus(
      ctx,
      args.chatroomId,
      args.role,
      enhancing ? 'agent.enhancing' : 'agent.waiting'
    );
  } else if (args.action === 'get-next-task:stopped') {
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
  } else if (args.action === NATIVE_WAITING_ACTION) {
    const active = await findActiveAssignedTaskForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
    if (!active && !stopped)
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.waiting');
  } else if (args.action === NATIVE_TASK_INJECTED_ACTION) {
    const acknowledged = await findAcknowledgedTaskForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: args.taskId,
    });
    if (acknowledged)
      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
    if (args.taskId && args.participantId)
      await ctx.db.patch('chatroom_participants', args.participantId, {
        lastInFlightTaskId: args.taskId,
      });
  }
}
