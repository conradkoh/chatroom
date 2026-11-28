/**
 * Remote folder-browse sessions (`api.folderBrowse.*`).
 *
 * Lifecycle (server-enforced): `pending -> ready | error`, driven by a monotonic `navSeq`.
 * Every `navigate` increments `navSeq` and resets the session to `pending`; a daemon report applies
 * only when `navSeq` matches and the session is still `pending`. Stale, duplicate, late and expired
 * reports change nothing. The latest navigation always wins, so no work is queued.
 *
 * Read paths: the web subscribes to `get` (a header-only doc) and `getListing` (the listing doc,
 * ownership checked through its own `userId`), so `navigate` never resends the listing. The daemon
 * subscribes to `daemonPending` through `by_machine_state`. `by_browseId` is the only listing index
 * read at runtime; `by_machineId` exists for the machine purge.
 *
 * Ephemerality: `expiresAt` is refreshed only by `open` and `navigate`; reads never write. `close`
 * deletes both rows, a 10-minute idle expiry plus a 5-minute cron removes abandoned sessions, and
 * machine deletion purges both tables. The selected path is never stored server-side.
 */

import {
  FOLDER_BROWSE_MAX_ACTIVE_PER_MACHINE,
  FOLDER_BROWSE_MAX_ENTRIES,
  FOLDER_BROWSE_MAX_ERROR_MESSAGE_LENGTH,
  FOLDER_BROWSE_MAX_FILTER_LENGTH,
  FOLDER_BROWSE_MAX_NAME_BYTES,
  FOLDER_BROWSE_MAX_NAME_LENGTH,
  FOLDER_BROWSE_MAX_PATH_LENGTH,
  FOLDER_BROWSE_PENDING_LIMIT,
  folderBrowseNameBytes,
  hasFolderBrowseControlCharacter,
  normalizeBrowsePath,
  type FolderBrowseEntry,
  type FolderBrowseErrorCode,
} from '@workspace/shared/domain/folder-browse';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalMutation, mutation, query } from './_generated/server';
import { getSession } from './auth/session';
import { normalizeWorkingDir } from './workspacePathSecurity';
import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { FOLDER_BROWSE_IDLE_TTL_MS } from '../config/reliability';
import { folderBrowseReportResultValidator } from '../src/domain/entities/folder-browse';

/** Expired sessions removed per cron run. A full batch reschedules the run. */
const CLEANUP_BATCH_ROWS = 100;

/** Session auth plus the browse id, shared by the id-addressed reads and close. */
const browseIdArgs = {
  ...SessionIdArg,
  browseId: v.id('chatroom_folderBrowseSessions'),
};

const NOT_AUTHENTICATED = {
  code: BACKEND_ERROR_CODES.NOT_AUTHENTICATED,
  message: 'Authentication required',
};

function notFound(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: BACKEND_ERROR_CODES.FOLDER_BROWSE_NOT_FOUND,
    message: 'Folder browse session not found',
  });
}

function invalidPath(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: BACKEND_ERROR_CODES.FOLDER_BROWSE_INVALID_PATH,
    message: 'Invalid folder path',
  });
}

function invalidListing(): never {
  throw new ConvexError({
    code: BACKEND_ERROR_CODES.FOLDER_BROWSE_INVALID_LISTING,
    message: 'Invalid folder listing',
  });
}

/**
 * The machine row, when the caller owns it. Throws when it is missing or owned by someone else.
 * Deliberately a local copy: each request module keeps its own ownership check instead of sharing a
 * helper, so a module can change without widening another module's reach.
 */
// fallow-ignore-next-line code-duplication
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

/** Normalize a browse path, mapping the shared path error to FOLDER_BROWSE_INVALID_PATH. */
function normalizePathOrThrow(raw: string): string {
  try {
    return normalizeBrowsePath(raw);
  } catch {
    throw invalidPath();
  }
}

/** Trim a filter; '' and undefined mean no filter. Over-long filters are an invalid path. */
function normalizeFilter(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > FOLDER_BROWSE_MAX_FILTER_LENGTH) throw invalidPath();
  return trimmed;
}

/** Delete a session's listing (if any) and then the session. */
async function deleteSessionRows(
  ctx: MutationCtx,
  browseId: Id<'chatroom_folderBrowseSessions'>
): Promise<void> {
  const listing = await ctx.db
    .query('chatroom_folderBrowseListings')
    .withIndex('by_browseId', (q) => q.eq('browseId', browseId))
    .first();
  if (listing) await ctx.db.delete('chatroom_folderBrowseListings', listing._id);
  await ctx.db.delete('chatroom_folderBrowseSessions', browseId);
}

/** `normalizeWorkingDir` decides whether the folder may be selected; it throws for unsafe or root paths. */
function isSelectableWorkingDir(path: string): boolean {
  try {
    normalizeWorkingDir(path);
    return true;
  } catch {
    return false;
  }
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

/** Keep a daemon-supplied error path renderable without rejecting the report. */
function sanitizeReportedPath(raw: string): string {
  try {
    return normalizeBrowsePath(raw);
  } catch {
    return raw.trim().slice(0, FOLDER_BROWSE_MAX_PATH_LENGTH);
  }
}

type ListingReport = {
  kind: 'listing';
  path: string;
  parentPath: string | null;
  entries: FolderBrowseEntry[];
  dirCount: number;
  fileCount: number;
  hiddenCount: number;
  complete: boolean;
};

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Entry names: non-empty, bounded, and never containing a path separator or control character. */
// fallow-ignore-next-line complexity
function validateEntryName(name: string): void {
  if (name.length === 0 || name.length > FOLDER_BROWSE_MAX_NAME_LENGTH) invalidListing();
  if (name.includes('/') || hasFolderBrowseControlCharacter(name)) invalidListing();
}

/** Entry count and byte budgets. */
function validateEntries(entries: FolderBrowseEntry[]): void {
  if (entries.length > FOLDER_BROWSE_MAX_ENTRIES) invalidListing();
  for (const entry of entries) validateEntryName(entry.name);
  if (folderBrowseNameBytes(entries) > FOLDER_BROWSE_MAX_NAME_BYTES) invalidListing();
}

/** Counts are non-negative integers, and `dirCount` covers every reported entry. */
// fallow-ignore-next-line complexity
function validateCounts(result: ListingReport): void {
  if (!isCount(result.dirCount) || !isCount(result.fileCount) || !isCount(result.hiddenCount)) {
    invalidListing();
  }
  if (result.dirCount < result.entries.length) invalidListing();
}

/** The path is already normalized, and the parent is its dirname (null at root). */
// fallow-ignore-next-line complexity
function validatePathShape(result: ListingReport): void {
  let normalizedPath: string | null = null;
  try {
    normalizedPath = normalizeBrowsePath(result.path);
  } catch {
    normalizedPath = null;
  }
  if (normalizedPath !== result.path) invalidListing();

  const expectedParent = result.path === '/' ? null : dirnameOf(result.path);
  if (result.parentPath !== expectedParent) invalidListing();
}

/** Enforce the listing contract. Throws FOLDER_BROWSE_INVALID_LISTING on any violation. */
function validateListing(result: ListingReport): ListingReport {
  validateEntries(result.entries);
  validateCounts(result);
  validatePathShape(result);
  return result;
}

/** Open a session on a machine owned by the caller, evicting the oldest beyond the cap. */
export const open = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    path: v.optional(v.string()),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new ConvexError(NOT_AUTHENTICATED);
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    const requestedPath = args.path === undefined ? null : normalizePathOrThrow(args.path);
    const now = Date.now();

    const existing = await ctx.db
      .query('chatroom_folderBrowseSessions')
      .withIndex('by_user_machine', (q) =>
        q.eq('userId', auth.userId).eq('machineId', args.machineId)
      )
      .take(10);
    const oldestFirst = [...existing].sort((a, b) => a.createdAt - b.createdAt);
    let openCount = oldestFirst.length;
    for (const session of oldestFirst) {
      if (openCount < FOLDER_BROWSE_MAX_ACTIVE_PER_MACHINE) break;
      await deleteSessionRows(ctx, session._id);
      openCount--;
    }

    const browseId = await ctx.db.insert('chatroom_folderBrowseSessions', {
      userId: auth.userId,
      machineId: args.machineId,
      state: 'pending',
      navSeq: 1,
      requestedPath,
      showHidden: false,
      pendingSince: now,
      createdAt: now,
      expiresAt: now + FOLDER_BROWSE_IDLE_TTL_MS,
    });
    return { browseId };
  },
});

/** Advance the session in place. Identical pending parameters are a no-op (no write, no TTL refresh). */
export const navigate = mutation({
  args: {
    ...SessionIdArg,
    browseId: v.id('chatroom_folderBrowseSessions'),
    path: v.union(v.string(), v.null()),
    showHidden: v.boolean(),
    filter: v.optional(v.string()),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new ConvexError(NOT_AUTHENTICATED);

    const row = await ctx.db.get('chatroom_folderBrowseSessions', args.browseId);
    if (!row || row.userId !== auth.userId) throw notFound();
    const now = Date.now();
    if (row.expiresAt <= now) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.FOLDER_BROWSE_EXPIRED,
        message: 'Folder browse session expired',
      });
    }

    const requestedPath = args.path === null ? null : normalizePathOrThrow(args.path);
    const filter = normalizeFilter(args.filter);

    if (
      row.state === 'pending' &&
      row.requestedPath === requestedPath &&
      row.showHidden === args.showHidden &&
      (row.filter ?? undefined) === filter
    ) {
      return { navSeq: row.navSeq };
    }

    const navSeq = row.navSeq + 1;
    await ctx.db.patch('chatroom_folderBrowseSessions', args.browseId, {
      navSeq,
      requestedPath,
      showHidden: args.showHidden,
      filter,
      state: 'pending',
      pendingSince: now,
      error: undefined,
      expiresAt: now + FOLDER_BROWSE_IDLE_TTL_MS,
    });
    return { navSeq };
  },
});

/** Delete the session and its listing. Idempotent; another user's session reports `closed: false`. */
export const close = mutation({
  args: browseIdArgs,
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new ConvexError(NOT_AUTHENTICATED);
    const row = await ctx.db.get('chatroom_folderBrowseSessions', args.browseId);
    if (!row || row.userId !== auth.userId) return { closed: false };
    await deleteSessionRows(ctx, args.browseId);
    return { closed: true };
  },
});

/** Header-only session view for the web. Null for an unknown session, another user, or no session. */
export const get = query({
  args: browseIdArgs,
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const row = await ctx.db.get('chatroom_folderBrowseSessions', args.browseId);
    if (!row || row.userId !== auth.userId) return null;
    return {
      browseId: row._id,
      machineId: row.machineId,
      state: row.state,
      navSeq: row.navSeq,
      requestedPath: row.requestedPath,
      showHidden: row.showHidden,
      filter: row.filter ?? null,
      pendingSince: row.pendingSince ?? null,
      error: row.error ?? null,
      expiresAt: row.expiresAt,
    };
  },
});

/**
 * The current listing. Reads ONLY the listing doc, so `navigate` never invalidates it.
 * Null when absent, for another user, or with no session.
 */
export const getListing = query({
  args: browseIdArgs,
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const listing = await ctx.db
      .query('chatroom_folderBrowseListings')
      .withIndex('by_browseId', (q) => q.eq('browseId', args.browseId))
      .first();
    if (!listing || listing.userId !== auth.userId) return null;
    return {
      seq: listing.seq,
      requestedPath: listing.requestedPath,
      path: listing.path,
      parentPath: listing.parentPath,
      entries: listing.entries,
      dirCount: listing.dirCount,
      fileCount: listing.fileCount,
      hiddenCount: listing.hiddenCount,
      truncated: listing.truncated,
      complete: listing.complete,
      selectable: listing.selectable,
      listedAt: listing.listedAt,
    };
  },
});

/**
 * Pending-row subscription for the daemon. Empty when unauthenticated, when the machine is not
 * owned by the caller, or when no pending row is both owned by the caller and unexpired.
 */
export const daemonPending = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.userId) return [];
    const rows = await ctx.db
      .query('chatroom_folderBrowseSessions')
      .withIndex('by_machine_state', (q) =>
        q.eq('machineId', args.machineId).eq('state', 'pending')
      )
      .take(FOLDER_BROWSE_PENDING_LIMIT);
    const now = Date.now();
    return rows
      .filter((row) => row.userId === auth.userId && row.expiresAt > now)
      .map((row) => ({
        browseId: row._id,
        navSeq: row.navSeq,
        path: row.requestedPath,
        showHidden: row.showHidden,
        filter: row.filter ?? null,
      }));
  },
});

/**
 * Record the daemon's result for one navigation. Checks run in this order and no write precedes
 * them: row exists and is owned by the caller (`not_found`), machine matches (throw), not
 * expired, `navSeq` matches, still pending, then listing validation.
 */
export const reportListing = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    browseId: v.id('chatroom_folderBrowseSessions'),
    navSeq: v.number(),
    result: folderBrowseReportResultValidator,
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new ConvexError(NOT_AUTHENTICATED);
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    const row = await ctx.db.get('chatroom_folderBrowseSessions', args.browseId);
    if (!row || row.userId !== auth.userId) return { outcome: 'not_found' as const };
    if (row.machineId !== args.machineId) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.NOT_AUTHORIZED_MACHINE,
        message: 'Folder browse session belongs to a different machine',
      });
    }
    const now = Date.now();
    if (row.expiresAt <= now) return { outcome: 'expired' as const };
    if (args.navSeq !== row.navSeq) return { outcome: 'stale' as const };
    if (row.state !== 'pending') return { outcome: 'duplicate' as const };

    if (args.result.kind === 'error') {
      await applyErrorReport(ctx, args.browseId, args.result);
    } else {
      await applyListingReport(
        ctx,
        { browseId: args.browseId, row, navSeq: args.navSeq, now },
        validateListing(args.result)
      );
    }
    return { outcome: 'applied' as const };
  },
});

/** Record a daemon error. The previous listing, if any, stays visible. */
async function applyErrorReport(
  ctx: MutationCtx,
  browseId: Id<'chatroom_folderBrowseSessions'>,
  result: { code: FolderBrowseErrorCode; message: string; path: string }
): Promise<void> {
  await ctx.db.patch('chatroom_folderBrowseSessions', browseId, {
    state: 'error',
    pendingSince: undefined,
    error: {
      code: result.code,
      message: result.message.slice(0, FOLDER_BROWSE_MAX_ERROR_MESSAGE_LENGTH),
      path: sanitizeReportedPath(result.path),
    },
  });
}

/** Replace the session's one listing doc and mark the session ready. */
async function applyListingReport(
  ctx: MutationCtx,
  report: {
    browseId: Id<'chatroom_folderBrowseSessions'>;
    row: Doc<'chatroom_folderBrowseSessions'>;
    navSeq: number;
    now: number;
  },
  listing: ListingReport
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_folderBrowseListings')
    .withIndex('by_browseId', (q) => q.eq('browseId', report.browseId))
    .first();

  const doc = {
    browseId: report.browseId,
    userId: report.row.userId,
    machineId: report.row.machineId,
    seq: report.navSeq,
    requestedPath: report.row.requestedPath,
    path: listing.path,
    parentPath: listing.parentPath,
    entries: listing.entries,
    dirCount: listing.dirCount,
    fileCount: listing.fileCount,
    hiddenCount: listing.hiddenCount,
    truncated: listing.entries.length < listing.dirCount,
    complete: listing.complete,
    selectable: isSelectableWorkingDir(listing.path),
    listedAt: report.now,
  };
  if (existing) await ctx.db.replace('chatroom_folderBrowseListings', existing._id, doc);
  else await ctx.db.insert('chatroom_folderBrowseListings', doc);

  await ctx.db.patch('chatroom_folderBrowseSessions', report.browseId, {
    state: 'ready',
    pendingSince: undefined,
    error: undefined,
  });
}

/**
 * Cron (every 5 min). Deletes sessions with `expiresAt < now` and their listings.
 * Reschedules itself when a full batch was taken, so an abandoned session is gone in about 15 min.
 */
export const cleanupExpiredFolderBrowseSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('chatroom_folderBrowseSessions')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(CLEANUP_BATCH_ROWS);
    for (const row of expired) {
      await deleteSessionRows(ctx, row._id);
    }
    if (expired.length === CLEANUP_BATCH_ROWS) {
      await ctx.scheduler.runAfter(0, internal.folderBrowse.cleanupExpiredFolderBrowseSessions, {});
    }
  },
});
