import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function completeMachineStopExecution(
  ctx: MutationCtx,
  args: {
    stopCommandId: Id<'chatroom_agentStopCommands'>;
    machineId: string;
    status: 'completed' | 'failed';
    errorMessage?: string;
  }
): Promise<void> {
  const execution = await ctx.db
    .query('chatroom_agentStopMachineExecutions')
    .withIndex('by_stopCommandId_machineId', (q) =>
      q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)
    )
    .unique();
  if (!execution) throw new Error('Machine execution not found');
  if (args.status === 'failed')
    for (const target of await ctx.db
      .query('chatroom_agentStopTargets')
      .withIndex('by_stopCommandId_machineId', (q) =>
        q.eq('stopCommandId', args.stopCommandId).eq('machineId', args.machineId)
      )
      .collect())
      if (target.status === 'pending' || target.status === 'processing')
        await ctx.db.patch("chatroom_agentStopTargets", target._id, {
          status: 'failed',
          errorCode: 'EXECUTION_FAILED',
          errorMessage: args.errorMessage ?? 'Machine execution failed',
          completedAt: Date.now(),
        });
  if (execution.status !== 'completed' && execution.status !== 'failed')
    await ctx.db.patch("chatroom_agentStopMachineExecutions", execution._id, {
      status: args.status,
      completedAt: Date.now(),
      errorMessage: args.errorMessage,
    });
  await rollupAgentStopCommandStatus(ctx, args.stopCommandId);
}
