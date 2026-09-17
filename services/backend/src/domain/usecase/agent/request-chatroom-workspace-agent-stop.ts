import { listLastSentLaunchRequestsForChatroom } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';

// fallow-ignore-next-line complexity
export async function requestChatroomWorkspaceAgentStop(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; finalizeChatroom?: boolean }
): Promise<{
  commandIds: Id<'chatroom_machineCommandInbox'>[];
  commands: {
    commandId: Id<'chatroom_machineCommandInbox'>;
    machineId: string;
    workingDir?: string;
  }[];
}> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return { commandIds: [], commands: [] };

  const workspaces = (
    await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect()
  ).filter((workspace) => isActiveWorkspace(workspace.removedAt));

  const [launchRequests, statusRows, participants] = await Promise.all([
    listLastSentLaunchRequestsForChatroom(ctx, { chatroomId: args.chatroomId }),
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
    ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect(),
  ]);
  const machineIds = new Set<string>();
  for (const request of launchRequests) machineIds.add(request.machineId);
  for (const status of statusRows) if (status.machineId) machineIds.add(status.machineId);
  for (const participant of participants)
    if (participant.machineId) machineIds.add(participant.machineId);

  if (machineIds.size === 0 && workspaces.length === 0) {
    return { commandIds: [], commands: [] };
  }

  const commandIds: Id<'chatroom_machineCommandInbox'>[] = [];
  const commands: {
    commandId: Id<'chatroom_machineCommandInbox'>;
    machineId: string;
    workingDir?: string;
  }[] = [];
  // A workspace-scoped command is important here: the daemon inbox uses its
  // working directory as the concurrency key, so separate workspaces can be
  // stopped in parallel without two rooms sharing a machine-wide barrier.
  for (const workspace of workspaces) {
    const commandId = await enqueueMachineCommand(ctx, {
      machineId: workspace.machineId,
      command: {
        type: 'agent.stop',
        chatroomId: args.chatroomId,
        workspaceId: workspace._id,
        workingDir: workspace.workingDir,
        ...(args.finalizeChatroom === undefined ? {} : { finalizeChatroom: args.finalizeChatroom }),
      },
    });
    commandIds.push(commandId);
    commands.push({ commandId, machineId: workspace.machineId, workingDir: workspace.workingDir });
  }
  // Preserve the legacy recovery path for agents recorded before workspace
  // registration was introduced.
  const workspaceMachineIds = new Set(workspaces.map((workspace) => workspace.machineId));
  for (const machineId of machineIds) {
    if (workspaceMachineIds.has(machineId)) continue;
    const commandId = await enqueueMachineCommand(ctx, {
      machineId,
      command: {
        type: 'agent.stop',
        chatroomId: args.chatroomId,
        ...(args.finalizeChatroom === undefined ? {} : { finalizeChatroom: args.finalizeChatroom }),
      },
    });
    commandIds.push(commandId);
    commands.push({ commandId, machineId });
  }
  return { commandIds, commands };
}

export async function requestWorkspaceAgentStop(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    machineId: string;
    role: string;
    workingDir?: string | undefined;
  }
): Promise<{ commandIds: Id<'chatroom_machineCommandInbox'>[] }> {
  const commandId = await enqueueMachineCommand(ctx, {
    machineId: args.machineId,
    command: {
      type: 'agent.stop',
      chatroomId: args.chatroomId,
      role: args.role,
      ...(args.workingDir ? { workingDir: args.workingDir } : {}),
    },
  });
  return { commandIds: [commandId] };
}
