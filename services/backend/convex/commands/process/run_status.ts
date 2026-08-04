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
  const run = await ctx.db.get('chatroom_commandRunsV2', args.runId);
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

  await ctx.db.patch('chatroom_commandRunsV2', args.runId, update);
}

export async function reapOrphansForMachine(
  ctx: MutationCtx,
  args: {
    machineId: string;
  }
) {
  const allRuns = await ctx.db
    .query('chatroom_commandRunsV2')
    .withIndex('by_machine_workingDir', (q) => q.eq('machineId', args.machineId))
    .collect();

  const now = Date.now();
  let reapedCount = 0;

  for (const run of allRuns) {
    if (run.status === 'pending' || run.status === 'running') {
      await ctx.db.patch('chatroom_commandRunsV2', run._id, {
        status: 'killed',
        terminationReason: 'daemon-restart',
        completedAt: now,
      });
      reapedCount++;
    }
  }

  return { reapedCount };
}

export async function clearStuckRuns(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  const allRuns = await ctx.db
    .query('chatroom_commandRunsV2')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .collect();

  const now = Date.now();
  let clearedCount = 0;

  for (const run of allRuns) {
    if (run.status === 'pending') {
      await ctx.db.patch('chatroom_commandRunsV2', run._id, {
        status: 'stopped',
        terminationReason: 'user-clear-stuck',
        completedAt: now,
      });
      clearedCount++;
    } else if (run.status === 'running') {
      await ctx.db.patch('chatroom_commandRunsV2', run._id, {
        status: 'stopped',
        terminationReason: 'user-clear-stuck',
        completedAt: now,
      });
      clearedCount++;
    }
  }

  return { clearedCount };
}
