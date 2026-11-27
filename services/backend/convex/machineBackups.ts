/**
 * Machine backup requests (`api.machineBackups.*`).
 *
 * A request is either an `inventory` snapshot of the machine's local backup files or an
 * ephemeral `download` copy of one archive. Owner-only: non-owners get the same result as a
 * missing resource. Queries never return `storageId`, `sha256` or a URL; the download URL leaves
 * only `createDownloadAccess` (a mutation) and is never stored. Mutations never throw after a
 * patch — they return a result object so the caller can branch.
 */
import {
  BACKUP_INVENTORY_MAX_ENTRIES,
  BACKUP_MAX_BYTES,
  BACKUP_UPLOAD_CONTENT_TYPE,
  BACKUP_UPLOAD_MAX_ATTEMPTS,
  isBackupFilename,
  type BackupErrorCode,
} from '@workspace/shared/domain/machine-backup';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { BACKEND_ERROR_CODES } from '../config/errorCodes';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { getMachineOwner, requireMachineOwner } from './auth/cli/machineAccess';
import { getSession } from './auth/session';
import {
  backupErrorCodeValidator,
  inventoryEntryValidator,
  isActiveDownloadStatus,
  isOrphanBackupBlob,
  isTerminal,
  toHexSha256,
  type BackupStatus,
} from '../src/domain/entities/machine-backup';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';
import {
  confirmPatch,
  downloadStartPatch,
  expiryPatch,
  failPatch,
  inventoryCompletedPatch,
  preparingPatch,
  readyPatch,
  requestedExpiresAt,
  terminalPatch,
  type BackupRow,
  type LifecycleOutcome,
} from '../src/domain/usecase/machine-backup/lifecycle';

/** Rows scanned when looking for a reusable request or the active download. */
const RECENT_SCAN_LIMIT = 20;
/** Rows scanned by `getActiveDownload`. */
const ACTIVE_SCAN_LIMIT = 10;
/** Expired rows handled per cron run. A full batch reschedules. */
const CRON_BATCH = 50;
/** Shared args for the three user-facing download mutations. */
const downloadRequestIdArgs = {
  ...SessionIdArg,
  requestId: v.id('chatroom_machineBackupRequests'),
};

async function scanRecent(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  limit: number
): Promise<BackupRow[]> {
  return ctx.db
    .query('chatroom_machineBackupRequests')
    .withIndex('by_machineId_createdAt', (q) => q.eq('machineId', machineId))
    .order('desc')
    .take(limit);
}

/** A backup request needs a connected daemon to list or upload files. */
// fallow-ignore-next-line code-duplication
async function requireOnlineMachine(ctx: MutationCtx, machineId: string): Promise<void> {
  const status = await ctx.db
    .query('chatroom_machineStatus')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (status?.status !== 'online') {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.MACHINE_OFFLINE,
      message: 'Machine is offline. Start the daemon to back up its files.',
    });
  }
}

/** Blob delete guarded by the system table (precedent: file-attachment/lifecycle.ts). */
async function deleteBlobIfPresent(ctx: MutationCtx, storageId: Id<'_storage'>): Promise<void> {
  if (await ctx.db.system.get('_storage', storageId)) await ctx.storage.delete(storageId);
}

/** Applies a lifecycle patch, deleting the stored copy first when the outcome says so. */
async function applyOutcome(
  ctx: MutationCtx,
  row: BackupRow,
  outcome: LifecycleOutcome
): Promise<void> {
  if (outcome.deleteBlob && row.storageId) await deleteBlobIfPresent(ctx, row.storageId);
  await ctx.db.patch('chatroom_machineBackupRequests', row._id, outcome.patch);
}

/** Patches a row failed with the given reason. */
async function failRow(
  ctx: MutationCtx,
  row: BackupRow,
  now: number,
  errorCode: BackupErrorCode | undefined,
  errorMessage?: string | undefined
): Promise<void> {
  await applyOutcome(ctx, row, failPatch(row, { now, errorCode, errorMessage }));
}

/** Ends a ready or downloading row as expired and deletes its stored copy. */
async function markExpired(ctx: MutationCtx, row: BackupRow, now: number): Promise<void> {
  await applyOutcome(ctx, row, terminalPatch(row, 'expired', now));
}

/**
 * Delete a reported blob only when it is a plausible orphan: our content type, recent creation.
 * Used for reports that no longer match a writable row.
 */
async function deleteOrphanCandidate(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  now: number
): Promise<void> {
  const meta = await ctx.db.system.get('_storage', storageId);
  if (meta && isOrphanBackupBlob(meta, now)) await ctx.storage.delete(storageId);
}

/**
 * Daemon-facing row load. Missing → null. A row of another machine throws before any write,
 * so a daemon can never touch another machine's request.
 */
async function loadForDaemon(
  ctx: MutationCtx,
  machineId: string,
  requestId: Id<'chatroom_machineBackupRequests'>
): Promise<BackupRow | null> {
  const row = await ctx.db.get('chatroom_machineBackupRequests', requestId);
  if (row && row.machineId !== machineId) {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.BACKUP_NOT_FOUND,
      message: 'Backup request not found for this machine',
    });
  }
  return row;
}

/** Missing or past `expiresAt` → ignored (the cron fails the row). Terminal → duplicate. */
function classifyForDaemon(
  row: BackupRow | null,
  now: number
): { kind: 'row'; row: BackupRow } | { kind: 'ignored' } | { kind: 'duplicate' } {
  if (!row) return { kind: 'ignored' };
  if (isTerminal(row.status)) return { kind: 'duplicate' };
  if (row.expiresAt <= now) return { kind: 'ignored' };
  return { kind: 'row', row };
}

/** Loads and classifies a daemon report after the caller's owner check. */
async function loadDaemonTarget(
  ctx: MutationCtx,
  machineId: string,
  requestId: Id<'chatroom_machineBackupRequests'>,
  now: number
) {
  return classifyForDaemon(await loadForDaemon(ctx, machineId, requestId), now);
}

/** Early success response for a daemon report that will not write. */
function earlyDaemonResponse(kind: 'ignored' | 'duplicate') {
  return kind === 'ignored'
    ? ({ ok: true as const, ignored: true as const } as const)
    : ({ ok: true as const, duplicate: true as const } as const);
}

/** The caller's own download row, or null for unknown, foreign, or inventory rows. */
async function loadOwnedDownload(
  ctx: MutationCtx,
  userId: Id<'users'>,
  requestId: Id<'chatroom_machineBackupRequests'>
): Promise<BackupRow | null> {
  const row = await ctx.db.get('chatroom_machineBackupRequests', requestId);
  if (!row || row.userId !== userId || row.kind !== 'download') return null;
  return row;
}

/** Projection for webapp queries. Explicit fields only; never `storageId`, `sha256`, or any URL. */
function toBackupRequestView(row: BackupRow) {
  return {
    _id: row._id,
    kind: row.kind,
    status: row.status,
    machineId: row.machineId,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    preparingAt: row.preparingAt,
    readyAt: row.readyAt,
    lastDownloadStartedAt: row.lastDownloadStartedAt,
    expiresAt: row.expiresAt,
    finishedAt: row.finishedAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    inventoryDir: row.inventoryDir,
    stackFound: row.stackFound,
    backups: row.backups,
    totalCount: row.totalCount,
    totalBytes: row.totalBytes,
    newestAt: row.newestAt,
    truncated: row.truncated,
  };
}

export type BackupRequestView = ReturnType<typeof toBackupRequestView>;

/** Active download rows among a recent scan. */
function activeDownloadRows(rows: BackupRow[], now: number): BackupRow[] {
  return rows.filter(
    (row) => row.kind === 'download' && isActiveDownloadStatus(row.status) && row.expiresAt > now
  );
}

type DownloadRequestDecision =
  | { kind: 'reuse'; requestId: Id<'chatroom_machineBackupRequests'> }
  | { kind: 'conflict' }
  | { kind: 'none' };

/** Reuse the same active filename, reject a different one, otherwise create. */
function decideDownloadRequest(active: BackupRow[], filename: string): DownloadRequestDecision {
  const same = active.find((row) => row.filename === filename);
  if (same) return { kind: 'reuse', requestId: same._id };
  return active.length > 0 ? { kind: 'conflict' } : { kind: 'none' };
}

/** Applies a reuse decision, throws for a conflict, and returns null when a new row is needed. */
function resolveDownloadDecision(
  decision: DownloadRequestDecision
): { requestId: Id<'chatroom_machineBackupRequests'>; reused: true } | null {
  if (decision.kind === 'conflict') {
    throw new ConvexError({
      code: BACKEND_ERROR_CODES.BACKUP_REQUEST_ACTIVE,
      message: 'Another backup is already being prepared on this machine',
    });
  }
  return decision.kind === 'reuse'
    ? { requestId: decision.requestId, reused: true as const }
    : null;
}

/** A pending, unexpired inventory request the caller can reuse. */
function reusableInventoryRequest(rows: BackupRow[], now: number): BackupRow | undefined {
  return rows.find(
    (row) => row.kind === 'inventory' && row.status === 'requested' && row.expiresAt > now
  );
}

/**
 * Ask a machine's daemon for an inventory of its local backups. Reuses a pending, unexpired
 * inventory request (enqueues nothing); otherwise inserts a request and enqueues one command.
 */
export const createInventoryRequest = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.BACKUP_NOT_FOUND,
        message: 'Machine not found',
      });
    }
    await requireOnlineMachine(ctx, args.machineId);

    const now = Date.now();
    const reusable = reusableInventoryRequest(
      await scanRecent(ctx, args.machineId, RECENT_SCAN_LIMIT),
      now
    );
    if (reusable) return { requestId: reusable._id, reused: true as const };

    const requestId = await ctx.db.insert('chatroom_machineBackupRequests', {
      userId: auth.userId,
      machineId: args.machineId,
      kind: 'inventory',
      status: 'requested',
      createdAt: now,
      updatedAt: now,
      expiresAt: requestedExpiresAt(now),
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.reportMachineBackups', requestId },
    });

    return { requestId, reused: false as const };
  },
});

/**
 * Ask a machine's daemon to upload one local backup archive.
 *
 * One stored copy at a time per machine: an active download for the same filename is reused, an
 * active download for another filename is rejected. The filename must match `isBackupFilename`.
 */
export const createDownloadRequest = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.BACKUP_NOT_FOUND,
        message: 'Machine not found',
      });
    }
    await requireOnlineMachine(ctx, args.machineId);

    if (!isBackupFilename(args.filename)) {
      throw new ConvexError({
        code: BACKEND_ERROR_CODES.BACKUP_INVALID_FILENAME,
        message: 'Not a backup filename produced by the local stack',
      });
    }

    const now = Date.now();
    const recent = await scanRecent(ctx, args.machineId, RECENT_SCAN_LIMIT);
    const decision = resolveDownloadDecision(
      decideDownloadRequest(activeDownloadRows(recent, now), args.filename)
    );
    if (decision) return decision;

    const requestId = await ctx.db.insert('chatroom_machineBackupRequests', {
      userId: auth.userId,
      machineId: args.machineId,
      kind: 'download',
      status: 'requested',
      filename: args.filename,
      createdAt: now,
      updatedAt: now,
      expiresAt: requestedExpiresAt(now),
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.uploadMachineBackup', requestId, filename: args.filename },
    });

    return { requestId, reused: false as const };
  },
});

/** One request by id. Owner only; null for an unknown or another user's request. */
export const getRequest = query({
  args: downloadRequestIdArgs,
  handler: async (ctx, args): Promise<BackupRequestView | null> => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const row = await ctx.db.get('chatroom_machineBackupRequests', args.requestId);
    if (!row || row.userId !== auth.userId) return null;
    return toBackupRequestView(row);
  },
});

/** The machine's active download request, if any. Reads at most the ten newest rows. */
export const getActiveDownload = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args): Promise<BackupRequestView | null> => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return null;

    const recent = await scanRecent(ctx, args.machineId, ACTIVE_SCAN_LIMIT);
    const active = activeDownloadRows(recent, Date.now())[0];
    return active ? toBackupRequestView(active) : null;
  },
});

type DownloadAccessBlock = 'not_ready' | 'not_found' | 'expired';

/** Statuses that cannot mint yet / that can still mint. */
const NOT_READY_DOWNLOAD_STATUSES: readonly BackupStatus[] = ['requested', 'preparing'];
const SERVABLE_DOWNLOAD_STATUSES: readonly BackupStatus[] = ['ready', 'downloading'];

/** Why the row's status cannot mint a URL, or null when it can. */
function downloadStatusBlocker(status: BackupStatus): DownloadAccessBlock | null {
  if (NOT_READY_DOWNLOAD_STATUSES.includes(status)) return 'not_ready';
  if (SERVABLE_DOWNLOAD_STATUSES.includes(status)) return null;
  return 'not_found';
}

/** Why a row cannot mint a URL, or null when it can. Finishes an expired copy. */
async function downloadAccessBlocker(
  ctx: MutationCtx,
  row: BackupRow,
  now: number
): Promise<DownloadAccessBlock | null> {
  const statusBlocker = downloadStatusBlocker(row.status);
  if (statusBlocker) return statusBlocker;
  if (!row.storageId) return 'expired';
  if (row.expiresAt > now) return null;
  await markExpired(ctx, row, now);
  return 'expired';
}

interface DownloadPayload {
  sizeBytes: number;
  filename: string;
  storageId: Id<'_storage'>;
}

/** The fields a ready download must have, or null when the row is incomplete. */
function downloadPayload(row: BackupRow): DownloadPayload | null {
  if (row.sizeBytes === undefined || row.filename === undefined || row.storageId === undefined) {
    return null;
  }
  return { sizeBytes: row.sizeBytes, filename: row.filename, storageId: row.storageId };
}

/** Mints the URL and restarts the download window for a row already known to be servable. */
async function serveDownload(ctx: MutationCtx, row: BackupRow) {
  const now = Date.now();
  const blocker = await downloadAccessBlocker(ctx, row, now);
  if (blocker) return { ok: false as const, reason: blocker };

  const payload = downloadPayload(row);
  if (!payload) return { ok: false as const, reason: 'not_ready' as const };

  const url = await ctx.storage.getUrl(payload.storageId);
  if (url === null) {
    await markExpired(ctx, row, now);
    return { ok: false as const, reason: 'expired' as const };
  }

  await applyOutcome(ctx, row, downloadStartPatch(row, now));
  return { ok: true as const, url, sizeBytes: payload.sizeBytes, filename: payload.filename };
}

/**
 * Mint a short-lived storage URL for the stored copy, and restart the download window.
 *
 * A mutation so the URL never enters a reactive query. Only `ready` and `downloading` rows with an
 * unexpired copy can mint; every other state returns a reason. The URL is never stored on the row.
 */
export const createDownloadAccess = mutation({
  args: downloadRequestIdArgs,
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { ok: false as const, reason: 'not_found' as const };
    const row = await loadOwnedDownload(ctx, auth.userId, args.requestId);
    if (!row) return { ok: false as const, reason: 'not_found' as const };
    return await serveDownload(ctx, row);
  },
});

/** Status part of the confirmation gate: duplicate, not downloading, or writable. */
function rowConfirmationBlocker(
  row: BackupRow
): { kind: 'duplicate' } | { kind: 'error'; reason: 'not_downloading' } | null {
  if (row.status === 'downloaded') return { kind: 'duplicate' };
  if (row.status !== 'downloading') return { kind: 'error', reason: 'not_downloading' };
  return null;
}

/** Data part of the confirmation gate: expiry or byte-count mismatch. */
function confirmationDataBlocker(
  row: BackupRow,
  receivedBytes: number,
  now: number
): 'expired' | 'size_mismatch' | null {
  if (row.expiresAt <= now) return 'expired';
  return receivedBytes !== row.sizeBytes ? 'size_mismatch' : null;
}

/**
 * Full confirmation gate. Finishes the row as expired when its window has passed.
 * Returns null only when the row is writable and the byte count matches.
 */
async function confirmationBlocker(
  ctx: MutationCtx,
  row: BackupRow,
  receivedBytes: number
): Promise<
  | { kind: 'duplicate' }
  | { kind: 'error'; reason: 'not_downloading' | 'expired' | 'size_mismatch' }
  | null
> {
  const rowBlocker = rowConfirmationBlocker(row);
  if (rowBlocker) return rowBlocker;

  const now = Date.now();
  const dataBlocker = confirmationDataBlocker(row, receivedBytes, now);
  if (dataBlocker === 'expired') await markExpired(ctx, row, now);
  return dataBlocker ? { kind: 'error', reason: dataBlocker } : null;
}

/**
 * Applies the confirmation gate to an owned row and returns the response. The row stays
 * `downloading` on a byte-count mismatch; a successful confirmation deletes the blob.
 */
async function confirmOwnedDownload(ctx: MutationCtx, row: BackupRow, receivedBytes: number) {
  const blocker = await confirmationBlocker(ctx, row, receivedBytes);
  if (blocker?.kind === 'duplicate') return { ok: true as const, duplicate: true as const };
  if (blocker) return { ok: false as const, reason: blocker.reason };

  await applyOutcome(ctx, row, confirmPatch(row, Date.now()));
  return { ok: true as const };
}

/**
 * Confirm the browser received the copy: delete the blob and finish the row.
 *
 * A byte-count mismatch leaves the row `downloading` so the browser can retry. A second
 * confirmation returns `{ ok: true, duplicate: true }`.
 */
export const writeDownloadConfirmation = mutation({
  args: {
    ...downloadRequestIdArgs,
    receivedBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    const row = auth ? await loadOwnedDownload(ctx, auth.userId, args.requestId) : null;
    if (!row) return { ok: false as const, reason: 'not_downloading' as const };

    return await confirmOwnedDownload(ctx, row, args.receivedBytes);
  },
});

/** Cancel a download request, deleting any stored copy. Always succeeds, even for unknown ids. */
export const cancelRequest = mutation({
  args: downloadRequestIdArgs,
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    const row = auth ? await loadOwnedDownload(ctx, auth.userId, args.requestId) : null;
    if (!row || isTerminal(row.status)) return { ok: true as const };

    await applyOutcome(ctx, row, terminalPatch(row, 'cancelled', Date.now()));
    return { ok: true as const };
  },
});

interface InventoryReport {
  now: number;
  inventoryDir?: string | undefined;
  stackFound?: boolean | undefined;
  backups?: BackupRow['backups'];
  totalCount?: number | undefined;
  totalBytes?: number | undefined;
  newestAt?: number | undefined;
  truncated?: boolean | undefined;
}

/** Writes a completed inventory snapshot, capping entries and flagging truncation. */
async function completeInventory(
  ctx: MutationCtx,
  row: BackupRow,
  report: InventoryReport
): Promise<void> {
  const reported = report.backups ?? [];
  await applyOutcome(
    ctx,
    row,
    inventoryCompletedPatch(row, {
      now: report.now,
      inventoryDir: report.inventoryDir,
      stackFound: report.stackFound,
      backups: reported.slice(0, BACKUP_INVENTORY_MAX_ENTRIES),
      totalCount: report.totalCount,
      totalBytes: report.totalBytes,
      newestAt: report.newestAt,
      truncated: report.truncated === true || reported.length > BACKUP_INVENTORY_MAX_ENTRIES,
    })
  );
}

/** True when an inventory report can still be written to this row. */
function inventoryReportWritable(row: BackupRow): boolean {
  return row.kind === 'inventory' && row.status === 'requested';
}

/** Daemon report of an inventory snapshot. */
export const reportInventory = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_machineBackupRequests'),
    status: v.union(v.literal('completed'), v.literal('failed')),
    inventoryDir: v.optional(v.string()),
    stackFound: v.optional(v.boolean()),
    backups: v.optional(v.array(inventoryEntryValidator)),
    totalCount: v.optional(v.number()),
    totalBytes: v.optional(v.number()),
    newestAt: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const target = await loadDaemonTarget(ctx, args.machineId, args.requestId, now);
    if (target.kind !== 'row') return earlyDaemonResponse(target.kind);

    const row = target.row;
    if (!inventoryReportWritable(row)) return earlyDaemonResponse('ignored');

    if (args.status === 'failed') {
      await failRow(ctx, row, now, undefined, args.errorMessage);
      return { ok: true as const };
    }

    await completeInventory(ctx, row, {
      now,
      inventoryDir: args.inventoryDir,
      stackFound: args.stackFound,
      backups: args.backups,
      totalCount: args.totalCount,
      totalBytes: args.totalBytes,
      newestAt: args.newestAt,
      truncated: args.truncated,
    });
    return { ok: true as const };
  },
});

/** True when the size is a positive integer within the upload cap. */
function validBackupSize(sizeBytes: number): boolean {
  return Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= BACKUP_MAX_BYTES;
}

/**
 * Applies the size gate and attempt cap. Patches the row failed and returns the reason when the
 * upload must not start, otherwise null. Never throws after a patch.
 */
async function rejectUpload(
  ctx: MutationCtx,
  row: BackupRow,
  sizeBytes: number,
  now: number
): Promise<{ ok: false; reason: 'too_large' | 'attempts_exhausted' } | null> {
  if (!validBackupSize(sizeBytes)) {
    await failRow(ctx, row, now, 'too_large', 'Backup is larger than the 256 MiB limit');
    return { ok: false, reason: 'too_large' };
  }
  if ((row.uploadAttempts ?? 0) + 1 > BACKUP_UPLOAD_MAX_ATTEMPTS) {
    await failRow(ctx, row, now, 'upload_failed', 'Upload attempts exhausted');
    return { ok: false, reason: 'attempts_exhausted' };
  }
  return null;
}

/** Why the row cannot start an upload, or null when it can. */
function uploadStartBlocker(row: BackupRow): 'ignored' | 'duplicate' | null {
  if (row.kind !== 'download') return 'ignored';
  if (row.status !== 'requested' && row.status !== 'preparing') return 'duplicate';
  return null;
}

/** Advances the attempt count and arms the preparing timeout. */
async function beginUpload(
  ctx: MutationCtx,
  row: BackupRow,
  sizeBytes: number,
  now: number
): Promise<void> {
  const attempts = (row.uploadAttempts ?? 0) + 1;
  await applyOutcome(ctx, row, preparingPatch(row, { now, sizeBytes, uploadAttempts: attempts }));
}

/**
 * Mint an upload URL for a download request and arm the preparing timeout.
 *
 * The size gate and the attempt cap patch the row `failed` and return, never throw after the patch.
 */
export const createUploadUrl = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_machineBackupRequests'),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const target = await loadDaemonTarget(ctx, args.machineId, args.requestId, now);
    if (target.kind !== 'row') return { ok: false as const, reason: target.kind };

    const row = target.row;
    const startBlocker = uploadStartBlocker(row);
    if (startBlocker) return { ok: false as const, reason: startBlocker };

    const rejection = await rejectUpload(ctx, row, args.sizeBytes, now);
    if (rejection) return rejection;

    await beginUpload(ctx, row, args.sizeBytes, now);
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { ok: true as const, uploadUrl };
  },
});

interface UploadFailure {
  reason: 'size_mismatch' | 'checksum_mismatch' | 'file_changed' | 'upload_failed';
  errorCode: BackupErrorCode;
  errorMessage: string;
}

interface UploadInput {
  row: BackupRow;
  meta: { size: number; sha256: string; contentType?: string } | null;
  sizeBytes: number;
  sha256: string;
  stable: boolean;
}

function sizeFailure(): UploadFailure {
  return {
    reason: 'size_mismatch',
    errorCode: 'size_mismatch',
    errorMessage: 'The uploaded backup size does not match the request',
  };
}

function checksumFailure(): UploadFailure {
  return {
    reason: 'checksum_mismatch',
    errorCode: 'checksum_mismatch',
    errorMessage: 'The uploaded backup does not match the reported checksum',
  };
}

/** Compares the reported size with the request and the row. */
function checkUploadedSize(input: UploadInput, meta: { size: number }): UploadFailure | null {
  return meta.size !== input.sizeBytes || meta.size !== input.row.sizeBytes ? sizeFailure() : null;
}

/** Every machine backup upload records our content type; a blob without it is not ours. */
function checkUploadedContentType(meta: { contentType?: string }): UploadFailure | null {
  if (meta.contentType === BACKUP_UPLOAD_CONTENT_TYPE) return null;
  return {
    reason: 'upload_failed',
    errorCode: 'upload_failed',
    errorMessage: 'The uploaded file is not a machine backup',
  };
}

/** Compares the reported digest with the stored one, both normalized to lowercase hex. */
function checkDigest(input: {
  sha256: string;
  storedSha256: string;
}): UploadFailure | { storedHex: string } {
  const reportedHex = toHexSha256(input.sha256);
  const storedHex = toHexSha256(input.storedSha256);
  if (reportedHex === null || storedHex === null || reportedHex !== storedHex) {
    return checksumFailure();
  }
  return { storedHex };
}

/** Size, content type and digest checks once a blob exists. */
function checkUploadedMetadata(
  input: UploadInput,
  meta: { size: number; sha256: string; contentType?: string }
): UploadFailure | { storedHex: string } {
  const size = checkUploadedSize(input, meta);
  if (size) return size;
  const contentType = checkUploadedContentType(meta);
  if (contentType) return contentType;
  return checkDigest({ sha256: input.sha256, storedSha256: meta.sha256 });
}

/**
 * Validates an uploaded blob against the preparing row. Returns the stored digest in hex when
 * every check passes, otherwise the reason and error code to fail the row with.
 */
function checkUploadedBlob(input: UploadInput): UploadFailure | { storedHex: string } {
  if (!input.stable) {
    return {
      reason: 'file_changed',
      errorCode: 'file_changed',
      errorMessage: 'The backup file changed while it was being read',
    };
  }
  if (input.meta === null) {
    return {
      reason: 'upload_failed',
      errorCode: 'upload_failed',
      errorMessage: 'The uploaded backup is missing',
    };
  }
  return checkUploadedMetadata(input, input.meta);
}

/** True when the report no longer matches a writable preparing row. */
function isLateUpload(row: BackupRow | null, now: number): boolean {
  return (
    row === null || row.kind !== 'download' || row.status !== 'preparing' || row.expiresAt <= now
  );
}

/** True when the row already reached a state that makes a repeat report a duplicate. */
function isDuplicateReportStatus(status: BackupStatus): boolean {
  return isTerminal(status) || status === 'ready' || status === 'downloading';
}

/** Response for a report that no longer matches a writable row. */
function lateUploadResponse(
  row: BackupRow | null
): { ok: true; duplicate: true } | { ok: true; ignored: true } {
  return row !== null && isDuplicateReportStatus(row.status)
    ? { ok: true as const, duplicate: true as const }
    : { ok: true as const, ignored: true as const };
}

/**
 * Daemon report that the archive was uploaded. Verifies the blob's size, content type and digest,
 * then patches the row `ready`. Any mismatch deletes the blob, fails the row and returns the reason.
 */
export const reportUploaded = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_machineBackupRequests'),
    storageId: v.id('_storage'),
    sizeBytes: v.number(),
    sha256: v.string(),
    stable: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Throws for another machine's row, before any write.
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await loadForDaemon(ctx, args.machineId, args.requestId);
    const now = Date.now();

    if (!row || isLateUpload(row, now)) {
      await deleteOrphanCandidate(ctx, args.storageId, now);
      return lateUploadResponse(row);
    }

    const meta = await ctx.db.system.get('_storage', args.storageId);
    const check = checkUploadedBlob({
      row,
      meta,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      stable: args.stable,
    });
    if ('reason' in check) {
      await deleteBlobIfPresent(ctx, args.storageId);
      await failRow(ctx, row, now, check.errorCode, check.errorMessage);
      return { ok: false as const, reason: check.reason };
    }

    await applyOutcome(
      ctx,
      row,
      readyPatch(row, {
        now,
        sizeBytes: args.sizeBytes,
        sha256Hex: check.storedHex,
        storageId: args.storageId,
      })
    );
    return { ok: true as const };
  },
});

/** True when a download row can still fail on a daemon report. */
function writableFailedRow(row: BackupRow): boolean {
  return row.kind === 'download' && (row.status === 'requested' || row.status === 'preparing');
}

/** Daemon report that the request failed before a stored copy existed. */
export const reportFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    requestId: v.id('chatroom_machineBackupRequests'),
    errorCode: backupErrorCodeValidator,
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const target = await loadDaemonTarget(ctx, args.machineId, args.requestId, now);
    if (target.kind !== 'row') return earlyDaemonResponse(target.kind);

    const row = target.row;
    if (!writableFailedRow(row)) return earlyDaemonResponse('ignored');

    await failRow(ctx, row, now, args.errorCode, args.errorMessage);
    return { ok: true as const };
  },
});

/** Deletes a terminal row (and any leftover blob), or applies the expiry outcome. */
async function expireOne(ctx: MutationCtx, row: BackupRow, now: number): Promise<void> {
  if (isTerminal(row.status)) {
    if (row.storageId) await deleteBlobIfPresent(ctx, row.storageId);
    await ctx.db.delete('chatroom_machineBackupRequests', row._id);
    return;
  }
  await applyOutcome(ctx, row, expiryPatch(row, now));
}

/**
 * Cron (every minute). Terminal rows are deleted; a non-terminal row past `expiresAt` is failed
 * (never served) or expired (copy ready or downloading), deleting any stored blob. A full batch
 * reschedules itself.
 */
export const cleanupExpiredBackupRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('chatroom_machineBackupRequests')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(CRON_BATCH);

    for (const row of expired) {
      await expireOne(ctx, row, now);
    }

    if (expired.length === CRON_BATCH) {
      await ctx.scheduler.runAfter(0, internal.machineBackups.cleanupExpiredBackupRequests, {});
    }
  },
});
