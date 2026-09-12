import { listTeamAgentConfigsForChatroom } from './list-team-agent-configs-for-chatroom';
import { shutdownChatroomTeam } from './shutdown-chatroom-team';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

function newOperationId(chatroomId: Id<'chatroom_rooms'>): string {
  return `${chatroomId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

// fallow-ignore-next-line complexity
export async function requestChatroomWorkspaceAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; finalizeChatroom?: boolean }
): Promise<{ commandIds: Id<'chatroomWorkspaceAgentCommandsInbox'>[] }> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return { commandIds: [] };

  const [configs, participants, enhancerJobs] = await Promise.all([
    listTeamAgentConfigsForChatroom(ctx, args.chatroomId),
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
  for (const config of configs) if (config.machineId) machineIds.add(config.machineId);
  for (const participant of participants)
    if (participant.machineId) machineIds.add(participant.machineId);
  for (const job of enhancerJobs) if (job.machineId) machineIds.add(job.machineId);

  // A user stop is also a read-model reset. Do this at request time so stale
  // WAITING/STARTING/ERROR rows cannot keep the UI active while a daemon is
  // offline or still draining its stop command. Daemon completion repeats the
  // same idempotent convergence after physical shutdown.
  if (args.finalizeChatroom !== false)
    await shutdownChatroomTeam(ctx, { chatroomId: args.chatroomId });

  if (machineIds.size === 0) {
    return { commandIds: [] };
  }

  const now = Date.now();
  const operationId = newOperationId(args.chatroomId);
  const commandIds: Id<'chatroomWorkspaceAgentCommandsInbox'>[] = [];
  for (const machineId of machineIds)
    commandIds.push(
      await ctx.db.insert('chatroomWorkspaceAgentCommandsInbox', {
        operationId,
        machineId,
        chatroomId: args.chatroomId,
        command: {
          type: 'stop_all_agents',
          ...(args.finalizeChatroom === undefined
            ? {}
            : { finalizeChatroom: args.finalizeChatroom }),
        },
        status: 'pending',
        createdAt: now,
      })
    );
  return { commandIds };
}

export async function requestWorkspaceAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; machineId: string; role: string }
): Promise<{ commandIds: Id<'chatroomWorkspaceAgentCommandsInbox'>[] }> {
  const commandId = await ctx.db.insert('chatroomWorkspaceAgentCommandsInbox', {
    operationId: newOperationId(args.chatroomId),
    machineId: args.machineId,
    chatroomId: args.chatroomId,
    command: { type: 'stop_agent', role: args.role },
    status: 'pending',
    createdAt: Date.now(),
  });
  return { commandIds: [commandId] };
}
