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
import { checkAccess, requireAccess } from './auth/accessCheck';
import { getAuthenticatedUser, requireAuthenticatedUser } from './auth/authenticatedUser';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max commands per workspace sync to prevent abuse. */
const MAX_COMMANDS_PER_SYNC = 500;

/** Max output chunk size (100KB). */
const MAX_OUTPUT_CHUNK_BYTES = 100 * 1024;

/** Max output chunks per run (to bound storage). */
const MAX_OUTPUT_CHUNKS_PER_RUN = 1000;

/** Terminal run statuses — once in these states a run cannot transition further. */
const TERMINAL_STATES = new Set<string>(['completed', 'failed', 'stopped', 'killed']);

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
        subWorkspace: v.optional(
          v.object({
            type: v.string(),
            path: v.string(),
            name: v.string(),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });
    if (!ownerCheck.ok)
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });

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
      await ctx.db.delete('chatroom_runnableCommands', cmd._id);
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
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

    // Security: Verify the command exists in the synced commands for this workspace.
    // This prevents arbitrary command injection — only pre-discovered scripts can be run.
    const existingCmd = await ctx.db
      .query('chatroom_runnableCommands')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .filter((q) =>
        q.and(q.eq(q.field('name'), args.commandName), q.eq(q.field('script'), args.script))
      )
      .first();

    if (!existingCmd) {
      throw new ConvexError({
        code: 'COMMAND_NOT_DISCOVERED',
        message: 'Command not found in synced commands. Only discovered scripts can be run.',
      });
    }

    const now = Date.now();

    // ── Back-to-back dedup (1-second window) ──────────────────────────────
    // Protect against double-click: if the same (machineId, workingDir, commandName, script)
    // request was dispatched within the last 1 second and the run is still 'pending',
    // return the existing runId instead of creating a duplicate.
    const recentPending = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir_status', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'pending')
      )
      .filter((q) =>
        q.and(
          q.eq(q.field('commandName'), args.commandName),
          q.eq(q.field('script'), args.script),
          q.gte(q.field('startedAt'), now - 1000)
        )
      )
      .first();

    if (recentPending) {
      // Idempotent re-issue within the dedup window — return the existing runId.
      return recentPending._id;
    }

    // ── Kill any currently running run for this (machineId, workingDir, commandName) ──
    // Replace semantics: mark the existing 'running' run as 'killed' + 'replaced' so the UI
    // sees the supersession immediately. The daemon will detect the 'killed' status and
    // terminate the process when it next processes events.
    const activeRun = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir_status', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'running')
      )
      .filter((q) => q.eq(q.field('commandName'), args.commandName))
      .first();

    if (activeRun) {
      await ctx.db.patch(activeRun._id, {
        status: 'killed',
        terminationReason: 'replaced',
        completedAt: now,
      });
    }

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
 * Stop a command run.
 *
 * Two paths:
 * - **Pending** runs: transition directly to 'stopped' inline. No OS process
 *   exists, so no daemon round-trip is needed. This prevents stuck runs when
 *   the daemon is unresponsive.
 * - **Running** runs: mark terminationReason and dispatch a command.stop event
 *   for the daemon to handle the actual process termination.
 */
export const stopCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRuns'),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

    const run = await ctx.db.get('chatroom_commandRuns', args.runId);
    if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
    if (run.machineId !== args.machineId)
      throw new ConvexError({
        code: 'RUN_WRONG_MACHINE',
        message: 'Run does not belong to this machine',
      });
    if (run.status !== 'running' && run.status !== 'pending') {
      throw new ConvexError({ code: 'COMMAND_NOT_RUNNING', message: 'Command is not running' });
    }

    const now = Date.now();

    if (run.status === 'pending') {
      // Pending run: no OS process exists — transition to stopped immediately.
      // Bypass the daemon round-trip so stuck runs don't stay pending forever.
      await ctx.db.patch(args.runId, {
        status: 'stopped',
        terminationReason: 'user-stop',
        completedAt: now,
      });
      return;
    }

    // Running run: mark terminationReason before the daemon stops the process
    await ctx.db.patch(args.runId, { terminationReason: 'user-stop' });

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
      v.literal('stopped'),
      v.literal('killed')
    ),
    pid: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    terminationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    const ownerCheck = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });
    if (!ownerCheck.ok)
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });

    const run = await ctx.db.get('chatroom_commandRuns', args.runId);
    if (!run) throw new ConvexError({ code: 'RUN_NOT_FOUND', message: 'Run not found' });
    if (run.machineId !== args.machineId)
      throw new ConvexError({
        code: 'RUN_WRONG_MACHINE',
        message: 'Run does not belong to this machine',
      });

    // ── Terminal-state idempotency ────────────────────────────────────────────
    // If the run is already in a terminal state, treat any further status
    // update as a silent no-op. This covers two races:
    //   1. terminal → terminal (e.g. killed → stopped): exit handler races
    //      with runCommand's inline kill. Both are 'truth' — the settled
    //      state is authoritative.
    //   2. terminal → running (e.g. stopped → running): user stopped a
    //      'pending' run inline (stopCommand), then the daemon processed the
    //      command.run event and tried to mark it running. The row is settled;
    //      the daemon's late write is a lie — suppress it.
    if (TERMINAL_STATES.has(run.status)) {
      return; // already settled — nothing to do
    }

    // State transition validation: only allow valid forward transitions
    // Note: 'killed' is set directly by runCommand (replace semantics) and by
    // clearStaleCommandRuns — not via this mutation.
    const validTransitions: Record<string, string[]> = {
      pending: ['running', 'failed', 'stopped', 'killed'],
      running: ['completed', 'failed', 'stopped', 'killed'],
    };
    const allowed = validTransitions[run.status];
    if (!allowed || !allowed.includes(args.status)) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.INVALID_RUN_STATE_TRANSITION,
        message: `Invalid run status transition: ${run.status} → ${args.status}`,
      });
    }

    const update: {
      status: typeof args.status;
      pid?: number;
      exitCode?: number;
      completedAt?: number;
      terminationReason?: string;
    } = { status: args.status };

    if (args.pid !== undefined) update.pid = args.pid;
    if (args.exitCode !== undefined) update.exitCode = args.exitCode;
    if (args.terminationReason !== undefined) update.terminationReason = args.terminationReason;

    // Set completedAt for terminal states
    if (
      args.status === 'completed' ||
      args.status === 'failed' ||
      args.status === 'stopped' ||
      args.status === 'killed'
    ) {
      update.completedAt = Date.now();
    }

    await ctx.db.patch('chatroom_commandRuns', args.runId, update);
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
    const ownerCheck = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });
    if (!ownerCheck.ok)
      throw new ConvexError({
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Not authorized for this machine',
      });

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
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

    return await ctx.db
      .query('chatroom_runnableCommands')
      .withIndex('by_machine_workingDir', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
      )
      .collect();
  },
});

/**
 * List active (pending or running) command runs for a workspace.
 * Used by the ActiveCommandRunsIndicator to show background processes.
 */
export const listActiveRuns = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return [];
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

    // Query pending runs
    const pendingRuns = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir_status', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'pending')
      )
      .collect();

    // Query running runs
    const runningRuns = await ctx.db
      .query('chatroom_commandRuns')
      .withIndex('by_machine_workingDir_status', (q) =>
        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir).eq('status', 'running')
      )
      .collect();

    // Return combined, sorted by startedAt descending
    return [...pendingRuns, ...runningRuns]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({
        _id: r._id,
        commandName: r.commandName,
        script: r.script,
        status: r.status,
        startedAt: r.startedAt,
      }));
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
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

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

    const run = await ctx.db.get('chatroom_commandRuns', args.runId);
    if (!run) return { chunks: [], run: null };

    // Verify the caller has access to this machine through chatroom membership
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: run.machineId },
      permission: 'write-access',
    });

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
 * Get the current status of a single command run.
 * Lightweight query used by the daemon to check run status before spawning.
 */
export const getRunStatus = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRuns'),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) return null;

    const run = await ctx.db.get('chatroom_commandRuns', args.runId);
    if (!run) return null;
    if (run.machineId !== args.machineId) return null;

    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

    return { status: run.status };
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
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

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
        await ctx.db.patch('chatroom_commandRuns', run._id, {
          status: 'stopped',
          completedAt: now,
        });
        clearedCount++;
      }
    }

    return { clearedCount };
  },
});

/**
 * User-callable escape hatch when the daemon is unreachable.
 * Clears stuck runs for a single (machineId, workingDir).
 * Differs from \`clearStaleCommandRuns\` which is daemon-startup-only
 * and machine-wide.
 */
export const clearStuckCommandRuns = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAuthenticatedUser(ctx, args.sessionId);
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'write-access',
    });

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
        // Pending run: no OS process — just mark stopped.
        await ctx.db.patch('chatroom_commandRuns', run._id, {
          status: 'stopped',
          terminationReason: 'user-clear-stuck',
          completedAt: now,
        });
        clearedCount++;
      } else if (run.status === 'running') {
        // Running run: mark stopped AND dispatch stop event so daemon
        // (if alive) can terminate the OS process.
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
  },
});
