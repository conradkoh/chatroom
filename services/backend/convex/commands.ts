/**
 * Convex functions for the Command Runner feature.
 *
 * This file owns the query()/mutation() declarations so that Convex routing
 * resolves api.commands.* to the correct HTTP endpoints. The actual handler
 * logic lives in focused helper modules under commands/.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { checkAccess, requireAccess } from './auth/accessCheck';
import { getAuthenticatedUser, requireAuthenticatedUser } from './auth/authenticatedUser';

import { handleRunCommand, handleStopCommand, handleAppendOutput } from './commands/mutations';
import {
  handleListCommands,
  handleListActiveRuns,
  handleListRuns,
  handleGetRunOutput,
  handleGetRunStatus,
} from './commands/queries';
import { syncCommands as handleSyncCommands } from './commands/process/sync';
import {
  updateRunStatus as handleUpdateRunStatus,
  clearStuckRuns as handleClearStuckCommandRuns,
  reapOrphansForMachine as handleReapOrphansForDaemonRestart,
} from './commands/process/run_status';

// ─── Mutations ──────────────────────────────────────────────────────────────

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

    await handleSyncCommands(ctx, args);
  },
});

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

    return await handleRunCommand(ctx, {
      ...args,
      requestedBy: auth.userId,
    });
  },
});

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

    await handleStopCommand(ctx, args);
  },
});

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

    await handleUpdateRunStatus(ctx, args);
  },
});

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

    await handleAppendOutput(ctx, args);
  },
});

// ─── Queries ────────────────────────────────────────────────────────────────

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

    return await handleListCommands(ctx, args);
  },
});

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

    return await handleListActiveRuns(ctx, args);
  },
});

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

    return await handleListRuns(ctx, args);
  },
});

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

    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: run.machineId },
      permission: 'write-access',
    });

    return await handleGetRunOutput(ctx, args);
  },
});

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

    return await handleGetRunStatus(ctx, args);
  },
});

// ─── Daemon Mutations ───────────────────────────────────────────────────────

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

    return await handleClearStuckCommandRuns(ctx, args);
  },
});

export const reapOrphansForDaemonRestart = mutation({
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

    return await handleReapOrphansForDaemonRestart(ctx, args);
  },
});
