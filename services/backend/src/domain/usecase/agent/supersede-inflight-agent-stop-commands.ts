import {
  projectAgentOperationalStatusForRole,
  projectAgentStopStateForRole,
} from './project-agent-operational-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

const INFLIGHT = ['pending', 'processing'] as const;

export async function supersedeInflightAgentStopCommands(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; exceptStopCommandId?: Id<'chatroom_agentStopCommands'> }
): Promise<Id<'chatroom_agentStopCommands'>[]> {
  const superseded: Id<'chatroom_agentStopCommands'>[] = [];
  for (const status of INFLIGHT) {
    const commands = await ctx.db
      .query('chatroom_agentStopCommands')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('status', status)
      )
      .collect();
    for (const command of commands) {
      if (command._id === args.exceptStopCommandId) continue;
      const targets = await ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', command._id))
        .collect();
      for (const target of targets)
        if (target.status === 'pending' || target.status === 'processing')
          await ctx.db.patch("chatroom_agentStopTargets", target._id, {
            status: 'superseded',
            errorMessage: 'superseded',
            completedAt: Date.now(),
          });
      const executions = await ctx.db
        .query('chatroom_agentStopMachineExecutions')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', command._id))
        .collect();
      for (const execution of executions) {
        if (execution.status === 'pending' || execution.status === 'processing')
          await ctx.db.patch("chatroom_agentStopMachineExecutions", execution._id, {
            status: 'superseded',
            errorMessage: 'superseded',
            completedAt: Date.now(),
          });
        if (execution.inboxCommandId) {
          const inbox = await ctx.db.get('chatroom_machineCommandInbox', execution.inboxCommandId);
          if (inbox?.status === 'pending')
            await ctx.db.delete('chatroom_machineCommandInbox', execution.inboxCommandId);
        }
      }
      await ctx.db.patch("chatroom_agentStopCommands", command._id, {
        status: 'superseded',
        errorCode: 'superseded',
        errorMessage: 'superseded',
        completedAt: Date.now(),
      });
      for (const role of [...new Set(targets.map((target) => target.role))]) {
        await projectAgentStopStateForRole(ctx, args.chatroomId, role);
        await projectAgentOperationalStatusForRole(ctx, args.chatroomId, role);
      }
      superseded.push(command._id);
    }
  }
  return superseded;
}
