import { shutdownChatroomTeam } from './shutdown-chatroom-team';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function completeChatroomWorkspaceAgentCommand(
  ctx: MutationCtx,
  args: {
    commandId: Id<'chatroomWorkspaceAgentCommandsInbox'>;
    machineId: string;
    finalizeChatroom?: boolean | undefined;
  }
): Promise<{ completed: boolean }> {
  const command = await ctx.db.get('chatroomWorkspaceAgentCommandsInbox', args.commandId);
  if (!command || command.machineId !== args.machineId) return { completed: false };
  if (command.status === 'completed') return { completed: false };
  await ctx.db.patch('chatroomWorkspaceAgentCommandsInbox', command._id, {
    status: 'completed',
    completedAt: Date.now(),
  });
  if (command.command.type === 'stop_all_agents' && command.command.finalizeChatroom !== false) {
    const operationRows = await ctx.db
      .query('chatroomWorkspaceAgentCommandsInbox')
      .withIndex('by_operationId', (q) => q.eq('operationId', command.operationId))
      .collect();
    if (operationRows.every((row) => row.status === 'completed'))
      await shutdownChatroomTeam(ctx, { chatroomId: command.chatroomId });
  }
  return { completed: true };
}
