import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import type { ChatroomAgentActivityStatusValue } from '@workspace/shared/domain/chatroom-agent-activity-status';

import type { Id, Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { findActiveAssignedTaskForRole } from '../task/find-acknowledged-task-for-role';

export type AgentRoleStatusReadModelStatus = ChatroomAgentActivityStatusValue;

type StatusEvent = {
  status: AgentRoleStatusReadModelStatus;
  errorSource?: 'configuration' | 'runtime' | 'task' | 'enhancer' | 'stop' | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
};

export function statusEventForAgentEvent(lastStatus: string): StatusEvent {
  if (lastStatus === 'agent.waiting' || lastStatus === 'task.completed')
    return { status: 'waiting' };
  if (
    lastStatus === 'agent.enhancing' ||
    lastStatus === 'agent.awaitingHandoff' ||
    lastStatus === 'task.inProgress' ||
    lastStatus === 'task.acknowledged'
  )
    return { status: 'working' };
  if (
    lastStatus === 'agent.requestStart' ||
    lastStatus === 'agent.restart' ||
    lastStatus === 'agent.restartPhase' ||
    lastStatus === 'agent.registered' ||
    lastStatus === 'agent.started' ||
    lastStatus === 'agent.sessionResumeRequested'
  )
    return { status: 'starting' };
  if (lastStatus === 'agent.requestStop') return { status: 'stopping' };
  if (lastStatus === 'agent.startFailed' || lastStatus === 'agent.providerUnavailable')
    return {
      status: 'error',
      errorSource: lastStatus === 'agent.providerUnavailable' ? 'runtime' : 'configuration',
      errorCode: lastStatus,
      errorMessage: `Agent reported ${lastStatus}`,
    };
  if (lastStatus === 'agent.sessionResumeFailed' || lastStatus === 'agent.sessionReopenRetry')
    return {
      status: 'error',
      errorSource: 'runtime',
      errorCode: lastStatus,
      errorMessage: `Agent reported ${lastStatus}`,
    };
  return { status: 'offline' };
}

export async function projectAgentRoleStatusReadModel(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    event?: StatusEvent | undefined;
    config?: Doc<'chatroom_teamAgentConfigs'> | undefined;
    lastSeenAt?: number | undefined;
  }
): Promise<void> {
  const role = args.role.trim().toLowerCase();
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return;

  const teamId = room.teamId;
  const config =
    args.config ??
    (teamId
      ? await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) =>
            q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, role))
          )
          .first()
      : null);
  const event = args.event ?? { status: 'offline' as const };
  const now = Date.now();
  const existing = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .first();
  const activeTask =
    event.status === 'working'
      ? await findActiveAssignedTaskForRole(ctx, { chatroomId: args.chatroomId, role })
      : null;
  const error =
    event.errorCode && event.errorSource
      ? {
          source: event.errorSource,
          code: event.errorCode,
          message: event.errorMessage ?? event.errorCode,
          occurredAt: now,
        }
      : undefined;
  const fields = omitUndefined({
    chatroomId: args.chatroomId,
    role,
    roleKind: isEphemeralAgentRole(role) ? ('ephemeral' as const) : ('persistent' as const),
    status: event.status,
    machineId: config?.machineId,
    ...(args.lastSeenAt !== undefined
      ? { lastSeenAt: args.lastSeenAt }
      : existing?.lastSeenAt !== undefined
        ? { lastSeenAt: existing.lastSeenAt }
        : {}),
    activeWork: activeTask ? { kind: 'task' as const, id: activeTask._id } : undefined,
    error,
    projectedAt: now,
  });
  if (existing) await ctx.db.patch('chatroom_agentRoleStatusReadModel', existing._id, fields);
  else await ctx.db.insert('chatroom_agentRoleStatusReadModel', fields);
}

export async function touchAgentRoleStatusLastSeen(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string; lastSeenAt?: number | undefined }
): Promise<void> {
  const role = args.role.trim().toLowerCase();
  const existing = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .first();
  if (!existing) return;
  await ctx.db.patch('chatroom_agentRoleStatusReadModel', existing._id, {
    lastSeenAt: args.lastSeenAt ?? Date.now(),
    projectedAt: Date.now(),
  });
}
