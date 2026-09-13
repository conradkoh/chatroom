import { listLastSentLaunchRequestsForChatroom } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';

// fallow-ignore-next-line complexity
export async function requestChatroomWorkspaceAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; finalizeChatroom?: boolean }
): Promise<{ commandIds: Id<'chatroom_machineCommandInbox'>[] }> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return { commandIds: [] };

  const [launchRequests, statusRows, participants, enhancerJobs] = await Promise.all([
    listLastSentLaunchRequestsForChatroom(ctx, { chatroomId: args.chatroomId }),
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
    ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
    ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', 'running')
      )
      .collect(),
  ]);
  const machineIds = new Set<string>();
  for (const request of launchRequests) machineIds.add(request.machineId);
  for (const status of statusRows) if (status.machineId) machineIds.add(status.machineId);
  for (const participant of participants)
    if (participant.machineId) machineIds.add(participant.machineId);
  for (const job of enhancerJobs) if (job.machineId) machineIds.add(job.machineId);

  if (machineIds.size === 0) {
    return { commandIds: [] };
  }

  const commandIds: Id<'chatroom_machineCommandInbox'>[] = [];
  for (const machineId of machineIds) {
    commandIds.push(
      await enqueueMachineCommand(ctx, {
        machineId,
        command: {
          type: 'agent.stop',
          chatroomId: args.chatroomId,
          ...(args.finalizeChatroom === undefined
            ? {}
            : { finalizeChatroom: args.finalizeChatroom }),
        },
      })
    );
  }
  return { commandIds };
}

export async function requestWorkspaceAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; machineId: string; role: string }
): Promise<{ commandIds: Id<'chatroom_machineCommandInbox'>[] }> {
  const commandId = await enqueueMachineCommand(ctx, {
    machineId: args.machineId,
    command: { type: 'agent.stop', chatroomId: args.chatroomId, role: args.role },
  });
  return { commandIds: [commandId] };
}
