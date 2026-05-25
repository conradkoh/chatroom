import type { QueryCtx } from '../_generated/server';

type RunId = any;

export async function handleListCommands(
  ctx: QueryCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  return await ctx.db
    .query('chatroom_runnableCommands')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .collect();
}

export async function handleListActiveRuns(
  ctx: QueryCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  const pendingRuns = await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir_status', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'pending')
    )
    .collect();

  const runningRuns = await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir_status', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'running')
    )
    .collect();

  return [...pendingRuns, ...runningRuns]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((r) => ({
      _id: r._id,
      commandName: r.commandName,
      script: r.script,
      status: r.status,
      startedAt: r.startedAt,
    }));
}

export async function handleListRuns(
  ctx: QueryCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  return await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .order('desc')
    .take(50);
}

export async function handleGetRunOutput(
  ctx: QueryCtx,
  args: {
    runId: RunId;
  }
) {
  const run = await ctx.db.get('chatroom_commandRuns', args.runId);
  if (!run) return { run: null, tail: null, chunks: [] };

  const isActive = run.status === 'running' || run.status === 'pending';

  if (isActive) {
    return {
      run,
      tail: run.tailOutput ?? null,
      chunks: [],
    };
  }

  // Terminal run: return completed chunks, no tail
  const chunks = await ctx.db
    .query('chatroom_commandOutput')
    .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
    .collect();

  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    run,
    tail: null,
    chunks,
  };
}

export async function handleGetRunStatus(
  ctx: QueryCtx,
  args: {
    machineId: string;
    runId: RunId;
  }
) {
  const run = await ctx.db.get('chatroom_commandRuns', args.runId);
  if (!run) return null;
  if (run.machineId !== args.machineId) return null;

  return { status: run.status };
}
