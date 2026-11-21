/**
 * Machine project roots (`api.machineProjectRoots.*`).
 *
 * Owner-facing list/add/remove of the directories a machine has opted into scanning.
 * `add` requires the machine to be online (the daemon consumes the change); `remove`
 * works offline. Every accepted change enqueues at most one pending
 * `daemon.syncProjectRoots` command, and the daemon reuses `list` to fetch the rows.
 *
 * Errors (`add`): `MACHINE_OFFLINE`, `INVALID_WORKING_DIR`, `PROJECT_ROOT_DUPLICATE`,
 * `PROJECT_ROOT_NESTED`, `PROJECT_ROOT_LIMIT_REACHED`, `NOT_AUTHORIZED_MACHINE`.
 * `list` is fail-open for non-owners (empty list); `remove` reports `{ removed: false }`
 * for unknown ids or ids owned by another machine.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { mutation, query } from './_generated/server';
import { getMachineOwner, requireMachineOwner } from './auth/cli/machineAccess';
import { addProjectRoot, removeProjectRoot } from '../src/domain/usecase/machine/project-roots';

/** Read the machine's roots, sorted by path. Non-owners get an empty list. */
export const list = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return { roots: [] };

    const rows = await ctx.db
      .query('chatroom_machineProjectRoots')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .take(100);

    const roots = rows
      .map((row) => ({ rootId: row._id, path: row.path, addedAt: row.addedAt }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return { roots };
  },
});

/** Add a root. Online only; enforces duplicate/nesting/limit and collapses children. */
export const add = mutation({
  args: { ...SessionIdArg, machineId: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const status = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (status?.status !== 'online') {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.MACHINE_OFFLINE,
        message: 'Machine is offline. Start the daemon to add a project root.',
      });
    }

    return addProjectRoot(ctx, {
      userId: auth.userId,
      machineId: args.machineId,
      path: args.path,
    });
  },
});

/** Remove a root by id. Works offline; unknown ids are a no-op for this machine. */
export const remove = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    rootId: v.id('chatroom_machineProjectRoots'),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return removeProjectRoot(ctx, { machineId: args.machineId, rootId: args.rootId });
  },
});
