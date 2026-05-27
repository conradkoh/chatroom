import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import { MAX_OUTPUT_CHUNK_BYTES, MAX_OUTPUT_CHUNKS_PER_RUN } from './types';

type RunId = any;

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
    .query('chatroom_commandRuns')
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
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir_status', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir).eq('status', 'running')
    )
    .filter((q) => q.eq(q.field('commandName'), commandName))
    .first();

  if (activeRun) {
    await ctx.db.patch(activeRun._id, {
      status: 'killed',
      terminationReason: 'replaced',
      completedAt: now,
    });
  }

  const runId: RunId = await ctx.db.insert('chatroom_commandRuns', {
    machineId,
    workingDir,
    commandName,
    script,
    status: 'pending',
    startedAt: now,
    requestedBy,
  });

  await ctx.db.insert('chatroom_eventStream', {
    type: 'command.run' as const,
    machineId,
    workingDir,
    commandName,
    script,
    runId,
    timestamp: now,
  });

  return runId;
}

export async function handleStopCommand(
  ctx: MutationCtx,
  args: {
    runId: RunId;
    machineId: string;
  }
) {
  const { runId, machineId } = args;
  const run = await ctx.db.get('chatroom_commandRuns', runId);
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
    await ctx.db.patch(runId, {
      status: 'stopped',
      terminationReason: 'user-stop',
      completedAt: now,
    });
    return;
  }

  await ctx.db.patch(runId, { terminationReason: 'user-stop' });

  await ctx.db.insert('chatroom_eventStream', {
    type: 'command.stop' as const,
    machineId,
    runId,
    timestamp: now,
  });
}

export async function handleAppendOutput(
  ctx: MutationCtx,
  args: {
    runId: RunId;
    content: string | { compression: 'gzip'; content: string };
    chunkIndex: number;
  }
) {
  // Size check: for compressed content, check the base64 string length (it's already ≤ original)
  const sizeForCheck = typeof args.content === 'string' ? args.content.length : args.content.content.length;
  if (sizeForCheck > MAX_OUTPUT_CHUNK_BYTES) {
    throw new ConvexError({
      code: 'OUTPUT_CHUNK_TOO_LARGE',
      message: `Output chunk too large (max ${MAX_OUTPUT_CHUNK_BYTES} bytes)`,
    });
  }

  const existingChunks = await ctx.db
    .query('chatroom_commandOutput')
    .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
    .take(MAX_OUTPUT_CHUNKS_PER_RUN);

  if (existingChunks.length >= MAX_OUTPUT_CHUNKS_PER_RUN) {
    return;
  }

  await ctx.db.insert('chatroom_commandOutput', {
    runId: args.runId,
    content: args.content,
    chunkIndex: args.chunkIndex,
    timestamp: Date.now(),
  });
}

export async function handleUpdateRunTail(
  ctx: MutationCtx,
  args: {
    machineId: string;
    runId: RunId;
    tailOutput: {
      compression: 'gzip';
      content: string;
      byteLength: number;
      totalBytesWritten: number;
      updatedAt: number;
    };
  }
) {
  const run = await ctx.db.get('chatroom_commandRuns', args.runId);
  if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
  if (run.machineId !== args.machineId)
    throw new ConvexError({
      code: 'RUN_WRONG_MACHINE',
      message: 'Run does not belong to this machine',
    });

  await ctx.db.patch(args.runId, {
    tailOutput: args.tailOutput,
  });
}
