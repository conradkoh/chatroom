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

/** Run metadata for history lists — excludes heavy tailOutput payload. */
export async function handleListRunsV2(
  ctx: QueryCtx,
  args: {
    machineId: string;
    workingDir: string;
  }
) {
  const runs = await ctx.db
    .query('chatroom_commandRuns')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .order('desc')
    .take(50);

  return runs.map(({ tailOutput: _tail, ...meta }) => meta);
}

const ACTIVE_RUN_STATUSES = new Set(['running', 'pending']);

export async function handleListRunsWithLogObservers(
  ctx: QueryCtx,
  args: {
    machineId: string;
  }
) {
  const [observed, pendingFull] = await Promise.all([
    ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machineId_logObserverCount', (q) =>
        q.eq('machineId', args.machineId).gte('logObserverCount', 1)
      )
      .collect(),
    ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machineId_pendingFullOutputSync', (q) =>
        q.eq('machineId', args.machineId).eq('pendingFullOutputSync', true)
      )
      .collect(),
  ]);

  const byId = new Map<
    string,
    { _id: (typeof observed)[number]['_id']; pendingFullOutputSync: boolean }
  >();

  for (const run of [...observed, ...pendingFull]) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    byId.set(run._id, {
      _id: run._id,
      pendingFullOutputSync: run.pendingFullOutputSync === true,
    });
  }

  return [...byId.values()];
}

export async function handleGetRunOutputV2(
  ctx: QueryCtx,
  args: {
    runId: RunId;
    loadFull?: boolean;
  }
) {
  const run = await ctx.db.get('chatroom_commandRuns', args.runId);
  if (!run) return { run: null, tail: null, chunks: [], fullOutputPending: false };

  const isActive = run.status === 'running' || run.status === 'pending';
  const hasObserver = (run.logObserverCount ?? 0) > 0;

  if (isActive && !args.loadFull) {
    return {
      run,
      tail: hasObserver ? (run.tailOutput ?? null) : null,
      chunks: [],
      fullOutputPending: run.pendingFullOutputSync === true,
    };
  }

  if (isActive && args.loadFull) {
    const chunks = await ctx.db
      .query('chatroom_commandOutput')
      .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
      .collect();
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return {
      run,
      tail: hasObserver ? (run.tailOutput ?? null) : null,
      chunks,
      fullOutputPending: run.pendingFullOutputSync === true,
    };
  }

  const chunks = await ctx.db
    .query('chatroom_commandOutput')
    .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
    .collect();
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  return {
    run,
    tail: chunks.length === 0 ? (run.tailOutput ?? null) : null,
    chunks,
    fullOutputPending: false,
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
