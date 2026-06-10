/**
 * Connection close-request endpoints.
 *
 * The list-based mechanism: every connection that should be terminated gets its
 * own row in chatroom_connectionCloseRequests. The owning get-next-task loop
 * self-terminates when getPendingTasksForRole sees a live row for its connectionId;
 * this module lets callers append requests, confirm a termination (emit event +
 * clear rows), and lets the daemon subscribe per machine.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireMachineOwner } from './auth/cli/machineAccess';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { mutation, query } from './_generated/server';
import { CONNECTION_CLOSE_REQUEST_TTL_MS } from '../config/reliability';

/**
 * Append a close request for a specific connection. General entry point for the
 * daemon / UI / future "terminate connection" command. Appends — never overwrites.
 */
export const requestConnectionClose = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    connectionId: v.string(),
    machineId: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const now = Date.now();
    await ctx.db.insert('chatroom_connectionCloseRequests', {
      chatroomId: args.chatroomId,
      role: args.role,
      connectionId: args.connectionId,
      machineId: args.machineId,
      reason: args.reason ?? 'requested',
      createdAt: now,
      expiresAt: now + CONNECTION_CLOSE_REQUEST_TTL_MS,
    });
  },
});

/**
 * Confirm a connection actually terminated. Emits a single connection.terminated
 * event and deletes the matching close-request rows. Called by the CLI loop when
 * it receives connection_closed.
 */
export const confirmConnectionClosed = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    connectionId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const now = Date.now();

    const rows = await ctx.db
      .query('chatroom_connectionCloseRequests')
      .withIndex('by_chatroom_role_connection', (q) =>
        q
          .eq('chatroomId', args.chatroomId)
          .eq('role', args.role)
          .eq('connectionId', args.connectionId)
      )
      .collect();

    const machineId = rows.find((r) => r.machineId)?.machineId;
    const reason = rows[0]?.reason ?? 'closed';

    await ctx.db.insert('chatroom_eventStream', {
      type: 'connection.terminated',
      chatroomId: args.chatroomId,
      role: args.role,
      connectionId: args.connectionId,
      ...(machineId ? { machineId } : {}),
      reason,
      timestamp: now,
    });

    for (const row of rows) {
      await ctx.db.delete('chatroom_connectionCloseRequests', row._id);
    }
  },
});

/**
 * Per-machine list of live (non-expired) connection close requests. The daemon
 * subscribes to this for observability / future UI; the authoritative closer is
 * the get-next-task loop itself (Option A).
 */
export const listConnectionCloseRequests = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const now = Date.now();
    const rows = await ctx.db
      .query('chatroom_connectionCloseRequests')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .collect();
    return rows.filter((r) => r.expiresAt > now);
  },
});
