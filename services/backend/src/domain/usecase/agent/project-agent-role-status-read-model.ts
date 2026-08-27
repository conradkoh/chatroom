import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import type { Id, Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export type AgentRoleStatusReadModelStatus =
  | 'offline'
  | 'starting'
  | 'waiting'
  | 'working'
  | 'stopping'
  | 'error';

type StatusEvent = {
  status: AgentRoleStatusReadModelStatus;
  errorSource?: 'configuration' | 'runtime' | 'task' | 'enhancer' | 'stop';
  errorCode?: string;
  errorMessage?: string;
};

export function statusEventForAgentEvent(lastStatus: string): StatusEvent {
  if (lastStatus === 'agent.waiting' || lastStatus === 'task.completed')
    return { status: 'waiting' };
  if (
    lastStatus === 'agent.enhancing' ||
    lastStatus === 'agent.awaitingHandoff' ||
    lastStatus === 'task.inProgress'
  )
    return { status: 'working' };
  if (
    lastStatus === 'agent.requestStart' ||
    lastStatus === 'agent.restart' ||
    lastStatus === 'agent.restartPhase' ||
    lastStatus === 'agent.registered' ||
    lastStatus === 'agent.started' ||
    lastStatus === 'task.acknowledged' ||
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
    event?: StatusEvent;
    config?: Doc<'chatroom_teamAgentConfigs'>;
  }
): Promise<void> {
  const role = args.role.trim().toLowerCase();
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return;

  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .first();
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
  const error =
    event.errorCode && event.errorSource
      ? {
          source: event.errorSource,
          code: event.errorCode,
          message: event.errorMessage ?? event.errorCode,
          occurredAt: now,
        }
      : undefined;
  const fields = {
    chatroomId: args.chatroomId,
    role,
    roleKind: isEphemeralAgentRole(role) ? ('ephemeral' as const) : ('persistent' as const),
    status: event.status,
    machineId: config?.machineId ?? participant?.machineId,
    lastSeenAt: participant?.lastSeenAt,
    activeWork:
      event.status === 'working' && participant?.lastInFlightTaskId
        ? { kind: 'task' as const, id: participant.lastInFlightTaskId }
        : undefined,
    error,
    projectedAt: now,
  };
  const existing = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .first();
  if (existing) await ctx.db.patch('chatroom_agentRoleStatusReadModel', existing._id, fields);
  else await ctx.db.insert('chatroom_agentRoleStatusReadModel', fields);
}
