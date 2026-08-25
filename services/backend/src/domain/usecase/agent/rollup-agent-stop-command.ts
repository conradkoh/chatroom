import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { projectAgentStopStateForRole } from './project-agent-operational-status';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { agentExited } from './agent-exited';

export async function rollupAgentStopCommandStatus(ctx: MutationCtx, stopCommandId: Id<'chatroom_agentStopCommands'>): Promise<void> {
  const command = await ctx.db.get('chatroom_agentStopCommands', stopCommandId);
  if (!command || command.status === 'completed' || command.status === 'failed') return;
  const executions = await ctx.db.query('chatroom_agentStopMachineExecutions').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId)).collect();
  const targets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', stopCommandId)).collect();
  const terminal = (status: string) => status === 'completed' || status === 'failed';
  if ((!executions.length && !targets.length) || !executions.every((e) => terminal(e.status)) || !targets.every((t) => terminal(t.status))) return;
  const failed = executions.some((e) => e.status === 'failed') || targets.some((t) => t.status === 'failed');
  await ctx.db.patch('chatroom_agentStopCommands', stopCommandId, { status: failed ? 'failed' : 'completed', completedAt: Date.now() });
  if (!failed) {
    for (const target of targets) {
      if (target.status === 'completed' && (target.outcome === 'stopped' || target.outcome === 'already_stopped')) {
        await agentExited(ctx, {
          chatroomId: command.chatroomId,
          role: target.role,
          machineId: target.machineId,
          pid: target.pid,
          revisionKey: target.revisionKey,
          stopReason: command.reason,
        });
        await projectAgentOperationalStatusForRole(ctx, command.chatroomId, target.role);
      }
    }
  }
  for (const role of [...new Set(targets.map((target) => target.role))]) await projectAgentStopStateForRole(ctx, command.chatroomId, role);
}
