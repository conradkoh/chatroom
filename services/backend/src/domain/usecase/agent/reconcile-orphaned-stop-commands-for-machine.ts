import { completeMachineStopExecution } from './complete-machine-stop-execution';
import { projectAgentStopStateForRole } from './project-agent-operational-status';
import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';
import type { MutationCtx } from '../../../../convex/_generated/server';

const INFLIGHT = ['pending', 'processing'] as const;

/**
 * Reconcile machine-local stop work after daemon restart. The daemon has lost
 * all local PIDs, so inflight targets for this machine are already stopped.
 */
export async function reconcileOrphanedStopCommandsForMachine(
  ctx: MutationCtx,
  machineId: string
): Promise<{ reconciledExecutionCount: number }> {
  let reconciledExecutionCount = 0;
  const now = Date.now();

  for (const status of INFLIGHT) {
    const executions = await ctx.db
      .query('chatroom_agentStopMachineExecutions')
      .withIndex('by_machineId_status', (q) => q.eq('machineId', machineId).eq('status', status))
      .collect();

    for (const execution of executions) {
      const targets = await ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId_machineId', (q) =>
          q.eq('stopCommandId', execution.stopCommandId).eq('machineId', machineId)
        )
        .collect();

      for (const target of targets) {
        if (!INFLIGHT.includes(target.status as (typeof INFLIGHT)[number])) continue;
        await ctx.db.patch('chatroom_agentStopTargets', target._id, {
          status: 'completed',
          outcome: 'already_stopped',
          termination: 'absent',
          completedAt: now,
        });
      }

      await completeMachineStopExecution(ctx, {
        stopCommandId: execution.stopCommandId,
        machineId,
        status: 'completed',
      });
      reconciledExecutionCount++;

      const command = await ctx.db.get('chatroom_agentStopCommands', execution.stopCommandId);
      if (command) {
        await rollupAgentStopCommandStatus(ctx, execution.stopCommandId);
        for (const role of [...new Set(targets.map((target) => target.role))])
          await projectAgentStopStateForRole(ctx, command.chatroomId, role);
      }
    }
  }

  return { reconciledExecutionCount };
}
