/**
 * Repository ledger snapshot requests (`api.repositoryLedger.*`).
 *
 * Lifecycle: pending → completed | failed (added in 3A-2). Terminal rows are immutable.
 * The daemon produces the snapshot. This module records the request and enqueues
 * `daemon.reportRepositoryLedger`. Snapshot data is transient and never durable.
 */
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS } from '../config/reliability';
import { LEDGER_MAX_CHUNKS } from '../src/domain/entities/repository-ledger';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';

/** Number of most recent requests for a machine scanned when looking for a reusable pending request. */
const RECENT_REQUEST_SCAN_LIMIT = 10;

/**
 * Queue a snapshot for a machine owned by the caller. Online only.
 * Reuses a pending, unexpired request that satisfies the ask (enqueues nothing); otherwise inserts
 * a pending row and enqueues exactly one `daemon.reportRepositoryLedger`.
 */
export const request = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    rescan: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const status = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (status?.status !== 'online') {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.MACHINE_OFFLINE,
        message: 'Machine is offline. Start the daemon to read its repositories.',
      });
    }

    const now = Date.now();
    const recent = await ctx.db
      .query('chatroom_repositoryLedgerRequests')
      .withIndex('by_machineId_createdAt', (q) => q.eq('machineId', args.machineId))
      .order('desc')
      .take(RECENT_REQUEST_SCAN_LIMIT);
    const reusable = recent.find(
      (row) => row.status === 'pending' && row.expiresAt > now && (row.rescan || !args.rescan)
    );
    if (reusable) return { requestId: reusable._id, reused: true as const };

    const requestId = await ctx.db.insert('chatroom_repositoryLedgerRequests', {
      userId: auth.userId,
      machineId: args.machineId,
      rescan: args.rescan,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.reportRepositoryLedger', requestId, rescan: args.rescan },
    });

    return { requestId, reused: false as const };
  },
});

/** Read a request by id. Owner only; null for unknown or other users' requests. Does not check expiry. */
export const get = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_repositoryLedgerRequests'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const row = await ctx.db.get('chatroom_repositoryLedgerRequests', args.requestId);
    if (!row || row.userId !== auth.userId) return null;
    return row;
  },
});

/**
 * Best-effort early clear (the UI calls it when the Repositories section closes).
 * Owner only. Deletes the request's chunks (≤ LEDGER_MAX_CHUNKS) and then the request row.
 * Unknown or non-owner ids are a no-op. Always returns { ok: true }.
 */
export const discard = mutation({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_repositoryLedgerRequests'),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { ok: true as const };
    const row = await ctx.db.get('chatroom_repositoryLedgerRequests', args.requestId);
    if (!row || row.userId !== auth.userId) return { ok: true as const };

    const chunks = await ctx.db
      .query('chatroom_repositoryLedgerChunks')
      .withIndex('by_request_chunk', (q) => q.eq('requestId', args.requestId))
      .take(LEDGER_MAX_CHUNKS);
    for (const chunk of chunks) {
      await ctx.db.delete('chatroom_repositoryLedgerChunks', chunk._id);
    }
    await ctx.db.delete('chatroom_repositoryLedgerRequests', args.requestId);
    return { ok: true as const };
  },
});
