/**
 * Chatroom export — Convex queries.
 *
 * Three thin, read-only queries over `export-read.ts` and `export-list.ts`. Auth
 * runs first, so an unauthenticated or non-owner call fails before any table is
 * read. The build and the consistency checks live outside Convex (the CLI and
 * convex-test call these queries through the export port), so one call reads at
 * most one page.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { validateSession } from './auth/sessionValidation';
import { listExportableChatroomsForMachine } from '../src/domain/usecase/chatroom-transfer/export-list';
import {
  readExportPage,
  readExportStamp,
} from '../src/domain/usecase/chatroom-transfer/export-read';

const exportCategoryValidator = v.union(
  v.literal('room'),
  v.literal('workspaces'),
  v.literal('agentConfigs'),
  v.literal('messages'),
  v.literal('messageQueue'),
  v.literal('tasks'),
  v.literal('backlog'),
  v.literal('artifacts'),
  v.literal('contexts'),
  v.literal('scheduledPrompts'),
  v.literal('savedCommands'),
  v.literal('skillCustomizations')
);

/** The consistency stamp the driver compares before and after paging. */
export const getStamp = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, a) => {
    await requireChatroomAccess(ctx, a.sessionId, a.chatroomId);
    return readExportStamp(ctx, a.chatroomId);
  },
});

/** One page of one category; the driver advances by cursor. */
export const readPage = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    category: exportCategoryValidator,
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, a) => {
    await requireChatroomAccess(ctx, a.sessionId, a.chatroomId);
    return readExportPage(ctx, {
      chatroomId: a.chatroomId,
      category: a.category,
      cursor: a.cursor,
    });
  },
});

/** The caller's own chatrooms with an active workspace on `machineId`; the set `export --all` walks. */
export const listForMachine = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, a) => {
    // Fail closed before any table read. The owner filter is the authorization.
    const session = await validateSession(ctx, a.sessionId);
    if (!session.ok) {
      throw new ConvexError({
        code: 'AUTH_FAILED',
        message: `Authentication failed: ${session.reason}`,
      });
    }
    return listExportableChatroomsForMachine(ctx, {
      userId: session.userId,
      machineId: a.machineId,
    });
  },
});
