/**
 * Repository ledger snapshot requests (`api.repositoryLedger.*`).
 *
 * Lifecycle: pending → completed | failed. Terminal rows are immutable.
 * The daemon produces the snapshot. This module records the request and enqueues
 * `daemon.reportRepositoryLedger`. Snapshot data is transient and never durable.
 */
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v, type Infer } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
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
  LEDGER_MAX_BRANCH_LENGTH,
  LEDGER_MAX_CHUNKS,
  LEDGER_MAX_ENTRIES,
  LEDGER_MAX_NAME_LENGTH,
  LEDGER_MAX_PATH_LENGTH,
  LEDGER_MAX_REMOTE_URL_LENGTH,
  LEDGER_MAX_ROOTS,
  ledgerEntryValidator,
  ledgerRootValidator,
} from '../src/domain/entities/repository-ledger';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';
import { findActiveChatroomForWorkingDir } from '../src/domain/usecase/workspace/find-active-chatroom-for-working-dir';

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

/** One snapshot row as the UI reads it. */
export interface RepositoryLedgerListEntry {
  path: string;
  name: string;
  root: string;
  branch?: string;
  remoteUrl?: string;
  discoveredAt: number;
  hasChatroom: boolean;
  chatroomId?: Id<'chatroom_rooms'>;
}

export interface RepositoryLedgerEntriesPage {
  page: RepositoryLedgerListEntry[];
  isDone: boolean;
  continueCursor: string;
}

const EMPTY_ENTRIES_PAGE: RepositoryLedgerEntriesPage = {
  page: [],
  isDone: true,
  continueCursor: '',
};

/** Owner check + expiry. A null row means missing (discarded or cleaned up). */
function isReadableLedgerRequest(
  request: LedgerRequestRow | null,
  userId: Id<'users'>
): request is LedgerRequestRow {
  return request !== null && request.userId === userId && request.expiresAt > Date.now();
}

/** Maps one stored entry to its list row. Stored paths are already normalized; the flag comes from the shared lookup. */
async function toListEntry(
  ctx: QueryCtx,
  input: { machineId: string; ownerId: Id<'users'> },
  entry: LedgerEntryInput
): Promise<RepositoryLedgerListEntry> {
  const active = await findActiveChatroomForWorkingDir(ctx, {
    ownerId: input.ownerId,
    machineId: input.machineId,
    workingDir: entry.path,
  });
  return {
    ...entry,
    hasChatroom: active !== null,
    ...(active ? { chatroomId: active.chatroomId } : {}),
  };
}

/**
 * Paginated snapshot rows for one request, in stored order. Owner only; a missing, discarded,
 * expired or other user's request returns an empty page (never throws). Pages are chunk-based:
 * `paginate` walks `by_request_chunk` and the page is the flattened chunk entries.
 * `numItems` is clamped to LEDGER_MAX_CHUNKS so one call reads at most 10 chunk documents.
 *
 * Reactivity: the only reads are the request row, `by_request_chunk`, and the shared lookup's
 * workspace/chatroom keys. A workspace row appearing at one of the page's paths re-runs the
 * query, which is what flips the badges after a chatroom is created or archived.
 */
export const listEntries = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_repositoryLedgerRequests'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<RepositoryLedgerEntriesPage> => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return EMPTY_ENTRIES_PAGE;
    const request = await ctx.db.get('chatroom_repositoryLedgerRequests', args.requestId);
    if (!isReadableLedgerRequest(request, auth.userId)) return EMPTY_ENTRIES_PAGE;

    const numItems = Math.min(Math.max(1, args.paginationOpts.numItems), LEDGER_MAX_CHUNKS);
    const chunks = await ctx.db
      .query('chatroom_repositoryLedgerChunks')
      .withIndex('by_request_chunk', (q) => q.eq('requestId', args.requestId))
      .paginate({ ...args.paginationOpts, numItems });

    const entries = chunks.page.flatMap((chunk) => chunk.entries);
    const page = await Promise.all(
      entries.map((entry) =>
        toListEntry(ctx, { machineId: request.machineId, ownerId: auth.userId }, entry)
      )
    );
    return { page, isDone: chunks.isDone, continueCursor: chunks.continueCursor };
  },
});

/** Response for a report that stored nothing: the row is gone or was already terminal. */
type EarlyReportResponse = { ok: true; ignored: true } | { ok: true; duplicate: true };

/** A writable request row, or the response to return without writing. */
type ReportTarget =
  { kind: 'row'; row: LedgerRequestRow } | { kind: 'early'; outcome: EarlyReportResponse };

/** True when the value is absent or within its cap. */
function withinCap(value: string | undefined, cap: number): boolean {
  return value === undefined || value.length <= cap;
}

/** Field caps on the raw values. An entry that fails any cap is rejected, never truncated. */
function fitsEntryCaps(entry: LedgerEntryInput): boolean {
  return [
    withinCap(entry.path, LEDGER_MAX_PATH_LENGTH),
    withinCap(entry.root, LEDGER_MAX_PATH_LENGTH),
    withinCap(entry.name, LEDGER_MAX_NAME_LENGTH),
    withinCap(entry.branch, LEDGER_MAX_BRANCH_LENGTH),
    withinCap(entry.remoteUrl, LEDGER_MAX_REMOTE_URL_LENGTH),
  ].every(Boolean);
}

/** The normalized path, or null when normalization rejects it. */
function normalizePathOrNull(path: string): string | null {
  try {
    return normalizeWorkingDir(path);
  } catch {
    return null;
  }
}

/** The normalized path for an entry that fits its caps, or null when the entry is rejected. */
function acceptedPath(entry: LedgerEntryInput): string | null {
  if (!fitsEntryCaps(entry)) return null;
  return normalizePathOrNull(entry.path);
}

/** Keep the first entry per already-normalized path; later duplicates are dropped. */
function dedupeByPath(entries: LedgerEntryInput[]): LedgerEntryInput[] {
  const seenPaths = new Set<string>();
  return entries.filter((entry) => {
    if (seenPaths.has(entry.path)) return false;
    seenPaths.add(entry.path);
    return true;
  });
}

/**
 * Keeps the first entry per normalized path. Rejected entries (invalid or over-long) and duplicate
 * paths are omitted and counted in `omittedCount`. Input is already capped to LEDGER_MAX_ENTRIES by the caller.
 */
function prepareEntries(input: LedgerEntryInput[]): {
  entries: LedgerEntryInput[];
  omittedCount: number;
} {
  const accepted: LedgerEntryInput[] = [];
  let rejectedCount = 0;
  for (const entry of input) {
    const path = acceptedPath(entry);
    if (path === null) {
      rejectedCount++;
      continue;
    }
    accepted.push({ ...entry, path });
  }
  const entries = dedupeByPath(accepted);
  return { entries, omittedCount: rejectedCount + (accepted.length - entries.length) };
}

/** The daemon's dropped count as stored: a missing, negative or non-finite value counts as 0. */
function sanitizeDroppedCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return 0;
  return Math.floor(count);
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
 * Entries are capped at LEDGER_MAX_ENTRIES, so the write is complete or absent. `invalidPathCount`
 * is the server's omitted count plus the daemon's sanitized `droppedEntryCount`.
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
    droppedEntryCount?: number | undefined;
  }
): Promise<void> {
  const reported = input.entries ?? [];
  const { entries, omittedCount } = prepareEntries(reported.slice(0, LEDGER_MAX_ENTRIES));
  const truncated = input.truncated === true || reported.length > LEDGER_MAX_ENTRIES;
  const now = Date.now();

  await insertChunks(ctx, row._id, machineId, entries);
  await ctx.db.patch('chatroom_repositoryLedgerRequests', row._id, {
    status: 'completed',
    completedAt: now,
    updatedAt: now,
    expiresAt: now + REPOSITORY_LEDGER_SNAPSHOT_TTL_MS,
    repositoryCount: entries.length,
    invalidPathCount: omittedCount + sanitizeDroppedCount(input.droppedEntryCount),
    truncated,
    ledgerGeneratedAt: input.ledgerGeneratedAt,
    roots: input.roots?.slice(0, LEDGER_MAX_ROOTS),
  });
}

/**
 * Daemon report. Owner + machine checked. Missing row ⇒ ignored (discarded or cleaned up).
 * Row for another machine ⇒ REPOSITORY_LEDGER_REQUEST_NOT_FOUND. Terminal row ⇒ duplicate.
 * Expired row ⇒ ignored, nothing stored. Otherwise: completed stores the snapshot in chunks and
 * patches the row terminal in the same transaction; failed patches the row only.
 *
 * Caps applied on completion: entries are capped at LEDGER_MAX_ENTRIES, entries with over-long
 * fields are dropped and counted in `invalidPathCount`, duplicate normalized paths are stored once
 * and also counted, the daemon's `droppedEntryCount` is added to that count, and roots are capped at
 * LEDGER_MAX_ROOTS. Entries past LEDGER_MAX_ENTRIES are not counted; they set `truncated`.
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
    /** Entries the daemon dropped before sending (over-cap or duplicate paths). Added to the stored invalidPathCount. */
    droppedEntryCount: v.optional(v.number()),
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
      droppedEntryCount: args.droppedEntryCount,
    });
    return { ok: true as const };
  },
});

/**
 * Best-effort early clear (the UI calls it when the Repositories section closes).
 * Owner only. Deletes every chunk of the request, in pages of LEDGER_MAX_CHUNKS, then the request row.
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
