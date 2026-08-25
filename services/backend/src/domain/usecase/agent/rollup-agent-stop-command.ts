import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAgentStopStateForRole } from './project-agent-operational-status';

export async function rollupAgentStopCommandStatus(ctx: MutationCtx, stopCommandId: Id<'chatroom_agentStopCommands'>): Promise<void> {
  const command = await ctx.db.get('chatroom_agentStopCommands', stopCommandId);
  if (!command || command.status === 'completed' || command.status === 'failed') return;
  const executions = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId)).collect();
  const targets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId)).collect();
  const terminal = (status: string) => status === 'completed' || status === 'failed';
  if ((!executions.length && !targets.length) || !executions.every((e) => terminal(e.status)) || !targets.every((t) => terminal(t.status))) return;
  const failed = executions.some((e) => e.status === 'failed') || targets.some((t) => t.status === 'failed');
  await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, { status: failed ? 'failed' : 'completed', completedAt: Date.now() });
  for (const role of [...new Set(targets.map((target) => target.role))]) await projectAgentStopStateForRole(ctx, command.chatroomId, role);
}
