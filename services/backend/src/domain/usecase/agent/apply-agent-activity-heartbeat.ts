import { touchAgentRoleStatusLastSeen } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_TASK_INJECTED_ACTION, NATIVE_WAITING_ACTION } from '../../entities/participant';
import { hasActiveEntryPointEnhancerJob } from '../enhancer/enhancer-entry-point-status';
import {
  findActiveAssignedTaskForRole,
  findAcknowledgedTaskForRole,
} from '../task/find-acknowledged-task-for-role';

export async function applyAgentActivityHeartbeat(
  ctx: MutationCtx,
  args: {
    machineId?: string | undefined;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    action: string;
    taskId?: Id<'chatroom_tasks'> | undefined;
    emittedAt?: number | undefined;
    revisionKey?: string | undefined;
  }
): Promise<void> {
  // Keep the high-frequency heartbeat path to one targeted read/patch. Status
  // transitions below intentionally fan out into the lifecycle projections.
  const accepted = await touchAgentRoleStatusLastSeen(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    lastSeenAt: args.emittedAt ?? Date.now(),
    lastSeenAction: args.action,
    machineId: args.machineId,
    eventAt: args.emittedAt,
    revisionKey: args.revisionKey,
  });
  if (!accepted) return;

  const projection = {
    machineId: args.machineId,
    emittedAt: args.emittedAt,
    revisionKey: args.revisionKey,
  };

  if (args.action === 'get-next-task:started') {
    const enhancing = await hasActiveEntryPointEnhancerJob(ctx, args.chatroomId);
    await transitionAgentStatus(
      ctx,
      args.chatroomId,
      args.role,
      enhancing ? 'agent.enhancing' : 'agent.waiting',
      undefined,
      undefined,
      projection
    );
  } else if (args.action === 'get-next-task:stopped') {
    await transitionAgentStatus(
      ctx,
      args.chatroomId,
      args.role,
      'task.acknowledged',
      undefined,
      undefined,
      projection
    );
  } else if (args.action === NATIVE_WAITING_ACTION) {
    const active = await findActiveAssignedTaskForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
    if (!active)
      await transitionAgentStatus(
        ctx,
        args.chatroomId,
        args.role,
        'agent.waiting',
        undefined,
        undefined,
        projection
      );
  } else if (args.action === NATIVE_TASK_INJECTED_ACTION) {
    const acknowledged = await findAcknowledgedTaskForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: args.taskId,
    });
    if (acknowledged)
      await transitionAgentStatus(
        ctx,
        args.chatroomId,
        args.role,
        'task.acknowledged',
        undefined,
        undefined,
        projection
      );
  }
}
