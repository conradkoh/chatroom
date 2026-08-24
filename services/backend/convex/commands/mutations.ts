import { ConvexError } from 'convex/values';

import { upsertRunTail, type TailPayload } from './tail';
import type { CommandRunId } from './types';
import { MAX_OUTPUT_CHUNK_BYTES, MAX_OUTPUT_CHUNKS_PER_RUN, MAX_TAIL_LINES_V2 } from './types';
import type { MutationCtx } from '../_generated/server';

export async function handleRunCommand(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
    commandName: string;
    script: string;
    requestedBy: any;
  }
) {
  const { machineId, workingDir, commandName, script, requestedBy } = args;
  const now = Date.now();

  const recentPending = await ctx.db
    .query('chatroom_commandRunsV2')
    .withIndex('by_machine_workingDir_status', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).eq('status', 'pending')
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('commandName'), commandName),
        q.eq(q.field('script'), script),
        q.gte(q.field('startedAt'), now - 1000)
      )
    )
    .first();

  if (recentPending) {
    return recentPending._id;
  }

  const activeRun = await ctx.db
    .query('chatroom_commandRunsV2')
    .withIndex('by_machine_workingDir_status', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).eq('status', 'running')
    )
    .filter((q) => q.eq(q.field('commandName'), commandName))
    .first();

  if (activeRun) {
    await ctx.db.patch('chatroom_commandRunsV2', activeRun._id, {
      status: 'killed',
      terminationReason: 'replaced',
      completedAt: now,
    });
  }

  const runId: CommandRunId = await ctx.db.insert('chatroom_commandRunsV2', {
    machineId,
    workingDir,
    commandName,
    script,
    status: 'pending',
    startedAt: now,
    requestedBy,
  });

  // The chatroom_commandRunsV2 row is the source of truth for command dispatch:
  // the daemon subscribes to pending rows on a dedicated channel, so no
  // The command run row is the authoritative record here.

  return runId;
}

export async function handleStopCommand(
  ctx: MutationCtx,
  args: {
    runId: CommandRunId;
    machineId: string;
  }
) {
  const { runId, machineId } = args;
  const run = await ctx.db.get('chatroom_commandRunsV2', runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
  if (run.machineId !== machineId)
    throw new ConvexError({
      code: 'RUN_WRONG_MACHINE',
      message: 'Run does not belong to this machine',
    });
  if (run.status !== 'running' && run.status !== 'pending') {
    throw new ConvexError({ code: 'COMMAND_NOT_RUNNING', message: 'Command is not running' });
  }

  const now = Date.now();

  if (run.status === 'pending') {
    await ctx.db.patch('chatroom_commandRunsV2', runId, {
      status: 'stopped',
      terminationReason: 'user-stop',
      completedAt: now,
    });
    return;
  }

  await ctx.db.patch('chatroom_commandRunsV2', runId, { terminationReason: 'user-stop' });

  // The daemon's dedicated command-run subscription picks up the running row
  // with terminationReason === 'user-stop' and dispatches the kill — no
  // The command run row is the authoritative record here.
}

export async function handleAppendOutput(
  ctx: MutationCtx,
  args: {
    runId: CommandRunId;
    content: { compression: 'gzip'; content: string };
    chunkIndex: number;
  }
) {
  const sizeForCheck = args.content.content.length;
  if (sizeForCheck > MAX_OUTPUT_CHUNK_BYTES) {
    throw new ConvexError({
      code: 'OUTPUT_CHUNK_TOO_LARGE',
      message: `Output chunk too large (max ${MAX_OUTPUT_CHUNK_BYTES} bytes)`,
    });
  }

  const existingChunks = await ctx.db
    .query('chatroom_commandOutputV2')
    .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
    .take(MAX_OUTPUT_CHUNKS_PER_RUN);

  if (existingChunks.length >= MAX_OUTPUT_CHUNKS_PER_RUN) {
    return;
  }

  await ctx.db.insert('chatroom_commandOutputV2', {
    runId: args.runId,
    compression: args.content.compression,
    content: args.content.content,
    chunkIndex: args.chunkIndex,
    timestamp: Date.now(),
  });
}

export async function handleUpsertRunTail(
  ctx: MutationCtx,
  args: {
    machineId: string;
    runId: CommandRunId;
    tailOutput: TailPayload;
  }
) {
  const run = await ctx.db.get('chatroom_commandRunsV2', args.runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
  if (run.machineId !== args.machineId)
    throw new ConvexError({
      code: 'RUN_WRONG_MACHINE',
      message: 'Run does not belong to this machine',
    });

  if ((run.logObserverCount ?? 0) <= 0) {
    throw new ConvexError({
      code: 'LOG_OBSERVER_NOT_ACTIVE',
      message: 'Cannot sync tail without an active log observer',
    });
  }

  if (args.tailOutput.lineCount > MAX_TAIL_LINES_V2) {
    throw new ConvexError({
      code: 'TAIL_TOO_LARGE',
      message: `Tail exceeds max ${MAX_TAIL_LINES_V2} lines`,
    });
  }

  await upsertRunTail(ctx, {
    runId: args.runId,
    machineId: args.machineId,
    tail: args.tailOutput,
  });
}

export async function handleSetRunLogObserver(
  ctx: MutationCtx,
  args: {
    runId: CommandRunId;
    observing: boolean;
  }
) {
  const run = await ctx.db.get('chatroom_commandRunsV2', args.runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });

  const current = run.logObserverCount ?? 0;
  const next = args.observing ? current + 1 : Math.max(0, current - 1);

  await ctx.db.patch('chatroom_commandRunsV2', args.runId, {
    logObserverCount: next,
  });

  return { logObserverCount: next };
}

export async function handleRequestRunOutputFullSync(
  ctx: MutationCtx,
  args: {
    runId: CommandRunId;
  }
) {
  const run = await ctx.db.get('chatroom_commandRunsV2', args.runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });

  await ctx.db.patch('chatroom_commandRunsV2', args.runId, {
    pendingFullOutputSync: true,
  });
}

export async function handleClearPendingFullOutputSync(
  ctx: MutationCtx,
  args: {
    machineId: string;
    runId: CommandRunId;
  }
) {
  const run = await ctx.db.get('chatroom_commandRunsV2', args.runId);
  if (!run) return;
  if (run.machineId !== args.machineId) return;

  await ctx.db.patch('chatroom_commandRunsV2', args.runId, {
    pendingFullOutputSync: false,
  });
}
