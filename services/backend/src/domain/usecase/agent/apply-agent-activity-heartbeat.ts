import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_TASK_INJECTED_ACTION, NATIVE_WAITING_ACTION } from '../../entities/participant';
import { hasActiveEntryPointEnhancerJob } from '../enhancer/enhancer-entry-point-status';
import { transitionAgentStatus } from './transition-agent-status';
import { findActiveAssignedTaskForRole, findAcknowledgedTaskForRole } from '../task/find-acknowledged-task-for-role';

export async function applyAgentActivityHeartbeat(ctx: MutationCtx, args: {
  chatroomId: Id<'chatroom_rooms'>; role: string; action: string; taskId?: Id<'chatroom_tasks'>;
  participantId?: Id<'chatroom_participants'>; emittedAt?: number;
}): Promise<void> {
  const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_chatroom', q => q.eq('chatroomId', args.chatroomId)).filter(q => q.eq(q.field('role'), args.role)).first();
  const stopped = config?.desiredState === 'stopped';
  if (args.action === 'get-next-task:started' && !stopped) {
    const enhancing = await hasActiveEntryPointEnhancerJob(ctx, args.chatroomId, args.role);
    await transitionAgentStatus(ctx, args.chatroomId, args.role, enhancing ? 'agent.enhancing' : 'agent.waiting');
  } else if (args.action === 'get-next-task:stopped') {
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
  } else if (args.action === NATIVE_WAITING_ACTION) {
    const active = await findActiveAssignedTaskForRole(ctx, { chatroomId: args.chatroomId, role: args.role });
    if (!active && !stopped) await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.waiting');
  } else if (args.action === NATIVE_TASK_INJECTED_ACTION) {
    const acknowledged = await findAcknowledgedTaskForRole(ctx, { chatroomId: args.chatroomId, role: args.role, taskId: args.taskId });
    if (acknowledged) await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
    if (args.taskId && args.participantId) await ctx.db.patch('chatroom_participants', args.participantId, { lastInFlightTaskId: args.taskId });
  }
}
