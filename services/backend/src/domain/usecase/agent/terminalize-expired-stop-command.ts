import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAgentStopStateForRole } from './project-agent-operational-status';
export async function terminalizeExpiredStopCommand(ctx: MutationCtx, stopCommandId: Id<'chatroom_agentStopCommands'>): Promise<void> {
  const command = await ctx.db.get('chatroom_agentStopCommands', stopCommandId); if (!command || ['completed','failed','superseded'].includes(command.status)) return;
  const targets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', q => q.eq('stopCommandId', stopCommandId)).collect(); const executions = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId', q => q.eq('stopCommandId', stopCommandId)).collect(); const now = Date.now();
  for (const t of targets) if (t.status === 'pending' || t.status === 'processing') await ctx.db.patch(t._id, { status: 'failed', errorCode: 'EXPIRED', errorMessage: 'stop command expired', completedAt: now });
  for (const e of executions) if (e.status === 'pending' || e.status === 'processing') await ctx.db.patch(e._id, { status: 'failed', errorMessage: 'stop command expired', completedAt: now });
  await ctx.db.patch(command._id, { status: 'failed', errorCode: 'EXPIRED', errorMessage: 'stop command expired', completedAt: now });
  for (const role of [...new Set(targets.map(t => t.role))]) await projectAgentStopStateForRole(ctx, command.chatroomId, role);
}
