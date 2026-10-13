/**
 * Folder picker requests from the setup wizard (`api.folderPickerRequests.*`).
 *
 * Lifecycle (server-enforced): pending → completed | cancelled | failed. Terminal rows are
 * immutable. A result report on a request that is no longer pending returns `duplicate` and changes
 * nothing.
 *
 * The daemon shows the native folder dialog. This module records the request and its result, and
 * enqueues `daemon.pickFolder`. Session auth and machine ownership are checked on every mutation.
 */

import { ConvexError, v, type ObjectType } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getSession } from './auth/session';
import { validateWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';

/** The machine row, when the caller owns it. Throws when it is missing or owned by someone else. */
async function getOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.MACHINE_NOT_FOUND,
      message: 'Machine not found',
    });
  }
  if (machine.userId !== userId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
      message: 'Machine is registered to a different user',
    });
  }
  return machine;
}

/**
 * Queue a folder picker on a machine owned by the caller.
 * Inserts a pending row and enqueues `daemon.pickFolder`.
 */
export const request = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.NOT_AUTHENTICATED,
        message: 'Authentication required',
      });
    }
    const userId = auth.userId;
    await getOwnedMachine(ctx, args.machineId, userId);

    const now = Date.now();
    const requestId = await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId: args.machineId,
      status: 'pending',
      createdAt: now,
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.pickFolder', requestId },
    });

    return { requestId };
  },
});

/** Poll a folder picker request from the webapp. Returns null for unknown or other users' requests. */
export const get = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_folderPickerRequests'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const request = await ctx.db.get('chatroom_folderPickerRequests', args.requestId);
    if (!request || request.userId !== auth.userId) return null;
    return request;
  },
});

/** Args of the daemon's result report. The deprecated machines delegate uses the same args. */
export const reportResultArgs = {
  ...SessionIdArg,
  requestId: v.id('chatroom_folderPickerRequests'),
  machineId: v.string(),
  status: v.union(v.literal('completed'), v.literal('cancelled'), v.literal('failed')),
  selectedPath: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
};

/** The request row, when it exists and belongs to the reporting machine. */
async function getRequestOfMachine(
  ctx: MutationCtx,
  requestId: Id<'chatroom_folderPickerRequests'>,
  machineId: string
) {
  const request = await ctx.db.get('chatroom_folderPickerRequests', requestId);
  if (!request) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.FOLDER_PICKER_REQUEST_NOT_FOUND,
      message: 'Folder picker request not found',
    });
  }
  if (request.machineId !== machineId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
      message: 'Folder picker request does not belong to this machine',
    });
  }
  return request;
}

/**
 * Records the daemon's result. Shared by `reportResult` and the deprecated delegate in
 * `machines.ts`, so both behave the same.
 */
export async function recordFolderPickerResult(
  ctx: MutationCtx,
  args: ObjectType<typeof reportResultArgs>
) {
  const auth = await getSession(ctx, args.sessionId);
  if (!auth) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.NOT_AUTHENTICATED,
      message: 'Authentication required',
    });
  }
  const machine = await getOwnedMachine(ctx, args.machineId, auth.userId);
  const request = await getRequestOfMachine(ctx, args.requestId, machine.machineId);
  // The first result wins. A repeated report changes nothing.
  if (request.status !== 'pending') {
    return { ok: true as const, duplicate: true as const };
  }

  if (args.selectedPath) {
    validateWorkingDir(args.selectedPath);
  }

  await ctx.db.patch('chatroom_folderPickerRequests', args.requestId, {
    status: args.status,
    selectedPath: args.selectedPath,
    errorMessage: args.errorMessage,
    completedAt: Date.now(),
  });

  return { ok: true as const };
}

/** Called by the CLI daemon after handling `daemon.pickFolder`. */
export const reportResult = mutation({
  args: reportResultArgs,
  handler: recordFolderPickerResult,
});
