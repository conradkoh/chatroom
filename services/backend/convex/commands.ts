/**
 * Convex functions for the Command Runner feature.
 *
 * - syncCommands: daemon syncs discovered package.json/turbo.json commands
 * - runCommand: UI dispatches a command run request
 * - stopCommand: UI requests stopping a running command
 * - updateRunStatus: daemon reports process lifecycle changes
 * - appendOutput: daemon flushes buffered terminal output
 * - listCommands: query available commands for a workspace
 * - listRuns: query command runs for a workspace
 * - getRunOutput: query output chunks for a run
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { getAuthenticatedUser, requireAuthenticatedUser } from './auth/authenticatedUser';
import { checkAccess, requireAccess } from './auth/accessCheck';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max commands per workspace sync to prevent abuse. */
const MAX_COMMANDS_PER_SYNC = 500;

/** Max output chunk size (100KB). */
const MAX_OUTPUT_CHUNK_BYTES = 100 * 1024;

/** Max output chunks per run (to bound storage). */
const MAX_OUTPUT_CHUNKS_PER_RUN = 1000;

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Sync discovered commands from a workspace.
 * Called by daemon during heartbeat. Replaces all commands for the workspace.
 */
export const syncCommands = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    commands: v.array(
      v.object({
        name: v.string(),
        script: v.string(),
        source: v.union(v.literal('package.json'), v.literal('turbo.json')),
        subWorkspace: v.optional(v.object({
          type: v.string(),
          path: v.string(),
          name: v.string(),
        })),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'owner' });
    if (!ownerCheck.ok) throw new ConvexError('Not authorized for this machine');

    if (args.commands.length > MAX_COMMANDS_PER_SYNC) {
      throw new ConvexError(`Too many commands (max ${MAX_COMMANDS_PER_SYNC})`);
    }

    // Delete existing commands for this workspace
    const existing = await ctx.db
      .query('chatroom_runnableCommands')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();

    for (const cmd of existing) {
      await ctx.db.delete(cmd._id);
    }

    // Insert new commands
    const now = Date.now();
    for (const cmd of args.commands) {
      await ctx.db.insert('chatroom_runnableCommands', {
        machineId: args.machineId,
        workingDir: args.workingDir,
        name: cmd.name,
        script: cmd.script,
        source: cmd.source,
        subWorkspace: cmd.subWorkspace,
        syncedAt: now,
      });
    }
  },
});

/**
 * Request running a command on a machine.
 * Creates a pending run and dispatches a command.run event to the daemon.
 */
export const runCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
    commandName: v.string(),
    script: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    // Security: Verify the command exists in the synced commands for this workspace.
    // This prevents arbitrary command injection — only pre-discovered scripts can be run.
    const existingCmd = await ctx.db
      .query('chatroom_runnableCommands')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('name'), args.commandName),
          q.eq(q.field('script'), args.script)
        )
      )
      .first();

    if (!existingCmd) {
      throw new ConvexError('Command not found in synced commands. Only discovered scripts can be run.');
    }

    const now = Date.now();

    // Create the run record
    const runId = await ctx.db.insert('chatroom_commandRuns', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      commandName: args.commandName,
      script: args.script,
      status: 'pending',
      startedAt: now,
      requestedBy: auth.userId,
    });

    // Dispatch command.run event to daemon
    await ctx.db.insert('chatroom_eventStream', {
      type: 'command.run' as const,
      machineId: args.machineId,
      workingDir: args.workingDir,
      commandName: args.commandName,
      script: args.script,
      runId,
      timestamp: now,
    });

    return runId;
  },
});

/**
 * Request stopping a running command.
 * Dispatches a command.stop event to the daemon.
 */
export const stopCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRuns'),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError('Run not found');
    if (run.machineId !== args.machineId) throw new ConvexError('Run does not belong to this machine');
    if (run.status !== 'running' && run.status !== 'pending') {
      throw new ConvexError('Command is not running');
    }

    const now = Date.now();

    // Dispatch command.stop event to daemon
    await ctx.db.insert('chatroom_eventStream', {
      type: 'command.stop' as const,
      machineId: args.machineId,
      runId: args.runId,
      timestamp: now,
    });
  },
});

/**
 * Update run status. Called by daemon when process starts, completes, or fails.
 */
export const updateRunStatus = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRuns'),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('stopped')
    ),
    pid: v.optional(v.number()),
    exitCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'owner' });
    if (!ownerCheck.ok) throw new ConvexError('Not authorized for this machine');

    const run = await ctx.db.get(args.runId);
    if (!run) throw new ConvexError('Run not found');
    if (run.machineId !== args.machineId) throw new ConvexError('Run does not belong to this machine');

    // State transition validation: only allow valid forward transitions
    const validTransitions: Record<string, string[]> = {
      pending: ['running', 'failed', 'stopped'],
      running: ['completed', 'failed', 'stopped'],
    };
    const allowed = validTransitions[run.status];
    if (!allowed || !allowed.includes(args.status)) {
      throw new ConvexError(`Invalid state transition: ${run.status} → ${args.status}`);
    }

    const update: {
      status: typeof args.status;
      pid?: number;
      exitCode?: number;
      completedAt?: number;
    } = { status: args.status };

    if (args.pid !== undefined) update.pid = args.pid;
    if (args.exitCode !== undefined) update.exitCode = args.exitCode;

    // Set completedAt for terminal states
    if (args.status === 'completed' || args.status === 'failed' || args.status === 'stopped') {
      update.completedAt = Date.now();
    }

    await ctx.db.patch(args.runId, update);
  },
});

/**
 * Append buffered output chunk. Called by daemon periodically (every ~3 seconds).
 */
export const appendOutput = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRuns'),
    content: v.string(),
    chunkIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'owner' });
    if (!ownerCheck.ok) throw new ConvexError('Not authorized for this machine');

    if (args.content.length > MAX_OUTPUT_CHUNK_BYTES) {
      throw new ConvexError(`Output chunk too large (max ${MAX_OUTPUT_CHUNK_BYTES} bytes)`);
    }

    // Check chunk count limit (use .take() instead of .collect() to avoid loading all chunks)
    const existingChunks = await ctx.db
      .query('chatroom_commandOutput')
      .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
      .take(MAX_OUTPUT_CHUNKS_PER_RUN);

    if (existingChunks.length >= MAX_OUTPUT_CHUNKS_PER_RUN) {
      // Silently drop — don't fail the daemon flush
      return;
    }

    await ctx.db.insert('chatroom_commandOutput', {
      runId: args.runId,
      content: args.content,
      chunkIndex: args.chunkIndex,
      timestamp: Date.now(),
    });
  },
});

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List available commands for a workspace.
 */
export const listCommands = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    return await ctx.db
      .query('chatroom_runnableCommands')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
  },
});

/**
 * List command runs for a workspace.
 * Returns most recent runs first (limited to 50).
 */
export const listRuns = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    const runs = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .order('desc')
      .take(50);

    return runs;
  },
});

/**
 * Get output for a specific run.
 * Returns all chunks in order.
 */
export const getRunOutput = query({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_commandRuns'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return { chunks: [], run: null };

    const run = await ctx.db.get(args.runId);
    if (!run) return { chunks: [], run: null };

    // Verify the caller has access to this machine through chatroom membership
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: run.machineId }, permission: 'write-access' });

    const chunks = await ctx.db
      .query('chatroom_commandOutput')
      .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', args.runId))
      .collect();

    // Sort by chunkIndex
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    return { chunks, run };
  },
});

/**
 * Clear all pending/running command runs for a machine on daemon startup.
 *
 * Called during daemon recovery so that any runs left in 'pending' or 'running'
 * state from before the restart are immediately marked as 'stopped'. This
 * prevents the UI from showing stale "running" indicators after a daemon crash
 * or restart.
 *
 * Bypasses updateRunStatus state-machine validation intentionally — startup
 * cleanup needs to force-stop regardless of prior state.
 */
export const clearStaleCommandRuns = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    await requireAccess(ctx, { accessor: { type: 'user', id: auth.userId }, resource: { type: 'machine', id: args.machineId }, permission: 'write-access' });

    // Query all runs for this machine using the machineId prefix of the
    // by_machine_workingDir index, then filter by status in code.
    const allRuns = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir', (q) => q.eq('machineId', args.machineId))
      .collect();

    const now = Date.now();
    let clearedCount = 0;

    for (const run of allRuns) {
      if (run.status === 'pending' || run.status === 'running') {
        await ctx.db.patch(run._id, { status: 'stopped', completedAt: now });
        clearedCount++;
      }
    }

    return { clearedCount };
  },
});
