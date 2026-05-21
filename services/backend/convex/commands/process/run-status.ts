import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { isTerminal, assertValidTransition } from '../fsm';
import { buildStatusUpdate, type RunId } from './state';

export async function updateRunStatus(
  ctx: MutationCtx,
  args: {
    machineId: string;
    runId: RunId;
    status: 'running' | 'completed' | 'failed' | 'stopped' | 'killed';
    pid?: number;
    exitCode?: number;
    terminationReason?: string;
  }
) {
  const run = await ctx.db.get('chatroom_commandRuns', args.runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
  if (run.machineId !== args.machineId)
    throw new ConvexError({
      code: 'RUN_WRONG_MACHINE',
      message: 'Run does not belong to this machine',
    });

  if (isTerminal(run.status)) {
    return;
  }

  assertValidTransition(run.status, args.status);

  const update = buildStatusUpdate(args.status, {
    pid: args.pid,
    exitCode: args.exitCode,
    terminationReason: args.terminationReason,
  });

  await ctx.db.patch('chatroom_commandRuns', args.runId, update);
}

export async function clearStaleRuns(
  ctx: MutationCtx,
  args: {
    machineId: string;
  }
) {
  const allRuns = await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir', (q) => q.eq('machineId', args.machineId))
    .collect();

  const now = Date.now();
  let clearedCount = 0;

  for (const run of allRuns) {
    if (run.status === 'pending' || run.status === 'running') {
      await ctx.db.patch('chatroom_commandRuns', run._id, {
        status: 'stopped',
        completedAt: now,
      });
      clearedCount++;
    }
  }

  return { clearedCount };
}

export async function clearStuckRuns(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  const allRuns = await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .collect();

  const now = Date.now();
  let clearedCount = 0;

  for (const run of allRuns) {
    if (run.status === 'pending') {
      await ctx.db.patch('chatroom_commandRuns', run._id, {
        status: 'stopped',
        terminationReason: 'user-clear-stuck',
        completedAt: now,
      });
      clearedCount++;
    } else if (run.status === 'running') {
      await ctx.db.patch('chatroom_commandRuns', run._id, {
        status: 'stopped',
        terminationReason: 'user-clear-stuck',
        completedAt: now,
      });
      await ctx.db.insert('chatroom_eventStream', {
        type: 'command.stop' as const,
        machineId: args.machineId,
        runId: run._id,
        timestamp: now,
      });
      clearedCount++;
    }
  }

  return { clearedCount };
}
