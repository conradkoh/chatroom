/**
 * Repository ledger snapshot requests (`api.repositoryLedger.*`).
 *
 * Lifecycle: pending → completed | failed. Terminal rows are immutable.
 * The daemon produces the snapshot. This module records the request and enqueues
 * `daemon.reportRepositoryLedger`. Snapshot data is transient and never durable.
 */
import { ConvexError, v, type Infer } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import { normalizeWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import {
  MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS,
  REPOSITORY_LEDGER_SNAPSHOT_TTL_MS,
} from '../config/reliability';
import {
  LEDGER_CHUNK_SIZE,
  LEDGER_MAX_CHUNKS,
  LEDGER_MAX_ENTRIES,
  ledgerEntryValidator,
  ledgerRootValidator,
} from '../src/domain/entities/repository-ledger';
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

type LedgerEntryInput = Infer<typeof ledgerEntryValidator>;
type LedgerRequestRow = Doc<'chatroom_repositoryLedgerRequests'>;

/** Response for a report that stored nothing: the row is gone or was already terminal. */
type EarlyReportResponse = { ok: true; ignored: true } | { ok: true; duplicate: true };

/** A writable request row, or the response to return without writing. */
type ReportTarget =
  { kind: 'row'; row: LedgerRequestRow } | { kind: 'early'; outcome: EarlyReportResponse };

/** Normalize each entry's path. Invalid paths are counted and dropped, never stored. Input is already capped. */
function prepareEntries(input: LedgerEntryInput[]): {
  entries: LedgerEntryInput[];
  invalidPathCount: number;
} {
  const entries: LedgerEntryInput[] = [];
  let invalidPathCount = 0;
  for (const entry of input) {
    try {
      entries.push({ ...entry, path: normalizeWorkingDir(entry.path) });
    } catch {
      invalidPathCount++;
    }
  }
  return { entries, invalidPathCount };
}

/** Insert the entries as chunk rows of LEDGER_CHUNK_SIZE. Runs inside the caller's transaction. */
async function insertChunks(
  ctx: MutationCtx,
  requestId: Id<'chatroom_repositoryLedgerRequests'>,
  machineId: string,
  entries: LedgerEntryInput[]
): Promise<void> {
  for (let chunkIndex = 0; chunkIndex * LEDGER_CHUNK_SIZE < entries.length; chunkIndex++) {
    const start = chunkIndex * LEDGER_CHUNK_SIZE;
    await ctx.db.insert('chatroom_repositoryLedgerChunks', {
      requestId,
      machineId,
      chunkIndex,
      entries: entries.slice(start, start + LEDGER_CHUNK_SIZE),
    });
  }
}

/** Delete every chunk of one request, in pages of LEDGER_MAX_CHUNKS. Returns how many were deleted. */
async function deleteRequestChunks(
  ctx: MutationCtx,
  requestId: Id<'chatroom_repositoryLedgerRequests'>
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const chunks = await ctx.db
      .query('chatroom_repositoryLedgerChunks')
      .withIndex('by_request_chunk', (q) => q.eq('requestId', requestId))
      .take(LEDGER_MAX_CHUNKS);
    if (chunks.length === 0) return deleted;
    for (const chunk of chunks) {
      await ctx.db.delete('chatroom_repositoryLedgerChunks', chunk._id);
    }
    deleted += chunks.length;
  }
}

/**
 * Missing row ⇒ ignored (discarded or cleaned up). Row of another machine ⇒
 * REPOSITORY_LEDGER_REQUEST_NOT_FOUND. Terminal row ⇒ duplicate. Expired row ⇒ ignored.
 */
async function resolveReportTarget(
  ctx: MutationCtx,
  machineId: string,
  requestId: Id<'chatroom_repositoryLedgerRequests'>
): Promise<ReportTarget> {
  const row = await ctx.db.get('chatroom_repositoryLedgerRequests', requestId);
  if (!row) return { kind: 'early', outcome: { ok: true, ignored: true } };
  if (row.machineId !== machineId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.REPOSITORY_LEDGER_REQUEST_NOT_FOUND,
      message: 'Repository ledger request not found for this machine',
    });
  }
  return classifyRequest(row);
}

/** Terminal rows are duplicates; rows past expiresAt (inclusive) are ignored. */
function classifyRequest(row: LedgerRequestRow): ReportTarget {
  if (row.status !== 'pending') return { kind: 'early', outcome: { ok: true, duplicate: true } };
  if (Date.now() >= row.expiresAt) return { kind: 'early', outcome: { ok: true, ignored: true } };
  return { kind: 'row', row };
}

/** Patch a request terminal as failed. Stores no chunks. */
async function markRequestFailed(
  ctx: MutationCtx,
  row: LedgerRequestRow,
  errorMessage: string | undefined
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch('chatroom_repositoryLedgerRequests', row._id, {
    status: 'failed',
    completedAt: now,
    updatedAt: now,
    expiresAt: now + REPOSITORY_LEDGER_SNAPSHOT_TTL_MS,
    errorMessage,
  });
}

/**
 * Store a completed snapshot: chunk rows then the terminal request row, in one transaction.
 * Entries are capped at LEDGER_MAX_ENTRIES, so the write is complete or absent.
 */
async function storeCompletedSnapshot(
  ctx: MutationCtx,
  row: LedgerRequestRow,
  machineId: string,
  input: {
    entries?: LedgerEntryInput[] | undefined;
    truncated?: boolean | undefined;
    roots?: Infer<typeof ledgerRootValidator>[] | undefined;
    ledgerGeneratedAt?: number | undefined;
  }
): Promise<void> {
  const reported = input.entries ?? [];
  const { entries, invalidPathCount } = prepareEntries(reported.slice(0, LEDGER_MAX_ENTRIES));
  const truncated = input.truncated === true || reported.length > LEDGER_MAX_ENTRIES;
  const now = Date.now();

  await insertChunks(ctx, row._id, machineId, entries);
  await ctx.db.patch('chatroom_repositoryLedgerRequests', row._id, {
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    expiresAt: now + REPOSITORY_LEDGER_SNAPSHOT_TTL_MS,
    repositoryCount: entries.length,
    invalidPathCount,
    truncated,
    ledgerGeneratedAt: input.ledgerGeneratedAt,
    roots: input.roots,
  });
}

/**
 * Daemon report. Owner + machine checked. Missing row ⇒ ignored (discarded or cleaned up).
 * Row for another machine ⇒ REPOSITORY_LEDGER_REQUEST_NOT_FOUND. Terminal row ⇒ duplicate.
 * Expired row ⇒ ignored, nothing stored. Otherwise: completed stores ≤ LEDGER_MAX_ENTRIES
 * entries in chunks and patches the row terminal in the same transaction; failed patches the row only.
 */
export const reportResult = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_repositoryLedgerRequests'),
    status: v.union(v.literal('completed'), v.literal('failed')),
    entries: v.optional(v.array(ledgerEntryValidator)),
    truncated: v.optional(v.boolean()),
    roots: v.optional(v.array(ledgerRootValidator)),
    ledgerGeneratedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const target = await resolveReportTarget(ctx, args.machineId, args.requestId);
    if (target.kind === 'early') return target.outcome;

    if (args.status === 'failed') {
      await markRequestFailed(ctx, target.row, args.errorMessage);
      return { ok: true as const };
    }

    await storeCompletedSnapshot(ctx, target.row, args.machineId, {
      entries: args.entries,
      truncated: args.truncated,
      roots: args.roots,
      ledgerGeneratedAt: args.ledgerGeneratedAt,
    });
    return { ok: true as const };
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
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { ok: true as const };
    const row = await ctx.db.get('chatroom_repositoryLedgerRequests', args.requestId);
    if (!row || row.userId !== auth.userId) return { ok: true as const };

    await deleteRequestChunks(ctx, args.requestId);
    await ctx.db.delete('chatroom_repositoryLedgerRequests', args.requestId);
    return { ok: true as const };
  },
});

/** Expired rows removed per cron run. A full batch reschedules the run. */
const CLEANUP_BATCH_ROWS = 100;
/**
 * Chunk documents deleted per run before the run stops starting new rows. Chunks are the only
 * large reads, so this keeps one run under the per-mutation read limit.
 */
const CLEANUP_CHUNK_BUDGET = 20;

/** Delete one expired request and its chunks. Returns the chunks deleted. */
async function purgeExpiredRequest(ctx: MutationCtx, row: LedgerRequestRow): Promise<number> {
  const deleted = await deleteRequestChunks(ctx, row._id);
  await ctx.db.delete('chatroom_repositoryLedgerRequests', row._id);
  return deleted;
}

/**
 * Purge rows until the batch ends or the chunk budget is spent. Returns how many rows were
 * processed; fewer than the batch means the run stopped early.
 */
async function purgeExpiredBatch(ctx: MutationCtx, expired: LedgerRequestRow[]): Promise<number> {
  let chunksDeleted = 0;
  let processed = 0;
  for (const row of expired) {
    if (chunksDeleted >= CLEANUP_CHUNK_BUDGET) break;
    chunksDeleted += await purgeExpiredRequest(ctx, row);
    processed++;
  }
  return processed;
}

/** A full batch or an early stop means more expired rows likely remain. */
function needsAnotherRun(expiredCount: number, processed: number): boolean {
  return expiredCount === CLEANUP_BATCH_ROWS || processed < expiredCount;
}

/**
 * Cron (every 5 min). Deletes requests (pending or terminal) with expiresAt < now, and their chunks.
 * Reschedules itself when the batch was full or the chunk budget stopped it early.
 */
export const cleanupExpiredLedgerRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('chatroom_repositoryLedgerRequests')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(CLEANUP_BATCH_ROWS);

    const processed = await purgeExpiredBatch(ctx, expired);
    if (needsAnotherRun(expired.length, processed)) {
      await ctx.scheduler.runAfter(0, internal.repositoryLedger.cleanupExpiredLedgerRequests, {});
    }
  },
});
