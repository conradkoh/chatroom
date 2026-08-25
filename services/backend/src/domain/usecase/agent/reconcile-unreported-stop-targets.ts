import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';

export async function reconcileUnreportedStopTargets(ctx: MutationCtx, args: { stopCommandId: Id<'chatroom_agentStopCommands'>; machineId: string; reportedTargetKeys: Set<string> }): Promise<void> {
  const targets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', args.stopCommandId)).collect();
  for (const target of targets) {
    if (target.machineId !== args.machineId || args.reportedTargetKeys.has(target.targetKey)) continue;
    if (target.status === 'pending' || target.status === 'processing') await ctx.db.patch(target._id, { status: 'completed', outcome: 'already_stopped', completedAt: Date.now() });
  }
  await rollupAgentStopCommandStatus(ctx, args.stopCommandId);
}
