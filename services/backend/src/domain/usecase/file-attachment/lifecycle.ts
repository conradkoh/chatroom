/**
 * File attachment lifecycle — upload reservation, authorization, completion,
 * and the single deletion golden path.
 *
 * Status lifecycle implemented here (monotonic):
 *   pending_upload (no blob, not counted, short TTL)
 *     → uploaded (blob present, counted, unattached TTL)
 *     → attached (blob present, counted, bound to a handoff message)
 *
 * Blobs are created only by the upload HTTP action after authorization, never
 * through a client-supplied `storageId` URL. Binding is a status-only change:
 * `uploaded` and `attached` rows both count toward usage (I3).
 *
 * Invariants:
 * - I1: `storageId` is set iff status is `uploaded` or `attached`.
 * - I3: usage counters track exactly the `uploaded`/`attached` rows (see
 *   `accounting.ts`).
 * - I4: `sizeBytes` equals the stored blob's size once uploaded.
 */

import {
  FILE_ATTACHMENT_MAX_BYTES,
  FILE_ATTACHMENT_MAX_PENDING_PER_USER,
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
  getStoredBlobContentType,
  isValidAttachmentFilename,
  resolveFileAttachmentType,
  type FileAttachmentMimeType,
} from '@workspace/shared/domain/file-attachment';
import { ConvexError } from 'convex/values';

import { applyFileUsageDelta, getFileUsage, resolveFileQuotas } from './accounting';
import type { BackendErrorCode } from '../../../../config/errorCodes';
import { internal } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getChatroomAccess } from '../../../../convex/auth/chatroomAccess';
import { validateSession } from '../../../../convex/auth/sessionValidation';
import type { ResolvedChatroom } from '../../../../convex/lib/chatroomTeam';
import { PENDING_UPLOAD_TTL_MS, UPLOADED_UNATTACHED_TTL_MS } from '../../entities/file-attachment';
import { getTeamRolesFromChatroom } from '../chatroom/get-team-roles';

/** Discriminated result shared by the authorize and complete steps. */
export type AuthorizeUploadResult =
  | {
      ok: true;
      /** The authorized ticket row, so callers do not resolve it twice. */
      row: Doc<'chatroom_fileAttachments'>;
      sizeBytes: number;
      storedContentType: string;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 404 | 409;
      code: BackendErrorCode;
      message: string;
    };

type AuthorizeUploadFailure = Extract<AuthorizeUploadResult, { ok: false }>;

/**
 * Reserves an attachment row for an upload.
 *
 * Rejects non-team senders, `user`, invalid filenames, disallowed types,
 * invalid or oversized sizes, owners already holding the maximum number of
 * unbound uploads, and requests that cannot fit in either quota.
 * Inserts a `pending_upload` row with no blob and a short expiry.
 *
 * @throws ConvexError with a stable code on every rejection.
 */
export async function beginFileUpload(
  ctx: MutationCtx,
  args: {
    chatroom: ResolvedChatroom;
    senderRole: string;
    filename: string;
    sizeBytes: number;
    now: number;
  }
): Promise<{ attachmentId: Id<'chatroom_fileAttachments'>; expiresAt: number }> {
  assertUploadSenderRole(args.chatroom, args.senderRole);
  const type = assertUploadRequest(args.filename, args.sizeBytes);
  await assertPendingUploadCapacity(ctx, args.chatroom.ownerId);
  await assertUploadFitsQuota(ctx, args.chatroom, args.sizeBytes);

  const expiresAt = args.now + PENDING_UPLOAD_TTL_MS;
  const attachmentId = await ctx.db.insert('chatroom_fileAttachments', {
    chatroomId: args.chatroom._id,
    ownerUserId: args.chatroom.ownerId,
    uploadedByRole: args.senderRole.toLowerCase(),
    filename: args.filename,
    mimeType: type.mimeType,
    sizeBytes: args.sizeBytes,
    status: 'pending_upload',
    createdAt: args.now,
    expiresAt,
  });

  return { attachmentId, expiresAt };
}

/** Rejects `user` and roles outside the chatroom's active team structure. */
function assertUploadSenderRole(chatroom: ResolvedChatroom, senderRole: string): void {
  const normalized = senderRole.toLowerCase();
  if (normalized === 'user') {
    throw new ConvexError({
      code: 'ACCESS_DENIED',
      message: 'Users cannot upload file attachments; only team roles can',
    });
  }

  const { teamRoles, normalizedTeamRoles } = getTeamRolesFromChatroom(chatroom);
  if (!normalizedTeamRoles.includes(normalized)) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: `Invalid senderRole: "${senderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`,
      fields: ['senderRole'],
    });
  }
}

/** Validates filename, type, and size, returning the resolved registry entry. */
function assertUploadRequest(
  filename: string,
  sizeBytes: number
): NonNullable<ReturnType<typeof resolveFileAttachmentType>> {
  const type = assertAllowedFilename(filename);
  assertValidUploadSize(sizeBytes);
  return type;
}

/** Rejects a filename that is malformed or not an allowlisted type. */
function assertAllowedFilename(
  filename: string
): NonNullable<ReturnType<typeof resolveFileAttachmentType>> {
  if (!isValidAttachmentFilename(filename)) {
    throw new ConvexError({
      code: 'FILE_ATTACHMENT_INVALID_FILENAME',
      message: `Invalid attachment filename: "${filename}"`,
    });
  }

  const type = resolveFileAttachmentType(filename);
  if (!type) {
    throw new ConvexError({
      code: 'FILE_ATTACHMENT_TYPE_NOT_ALLOWED',
      message: `File type is not allowlisted for attachments: "${filename}"`,
    });
  }

  return type;
}

/** Rejects a size that is not a positive integer within the hard limit. */
function assertValidUploadSize(sizeBytes: number): void {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new ConvexError({
      code: 'FILE_ATTACHMENT_INVALID',
      message: 'sizeBytes must be a positive integer',
    });
  }

  if (sizeBytes > FILE_ATTACHMENT_MAX_BYTES) {
    throw new ConvexError({
      code: 'FILE_ATTACHMENT_TOO_LARGE',
      message: `Attachment exceeds the maximum size of ${FILE_ATTACHMENT_MAX_BYTES} bytes`,
    });
  }
}

/**
 * Rejects a new reservation when the owner already holds the maximum number of
 * unbound uploads. The count is bounded by the limit itself, so the scan never
 * reads more than `2 * FILE_ATTACHMENT_MAX_PENDING_PER_USER` rows.
 */
async function assertPendingUploadCapacity(
  ctx: MutationCtx,
  ownerUserId: Id<'users'>
): Promise<void> {
  const pending = await ctx.db
    .query('chatroom_fileAttachments')
    .withIndex('by_owner_status_attachedAt', (q) =>
      q.eq('ownerUserId', ownerUserId).eq('status', 'pending_upload')
    )
    .take(FILE_ATTACHMENT_MAX_PENDING_PER_USER);
  const uploaded = await ctx.db
    .query('chatroom_fileAttachments')
    .withIndex('by_owner_status_attachedAt', (q) =>
      q.eq('ownerUserId', ownerUserId).eq('status', 'uploaded')
    )
    .take(FILE_ATTACHMENT_MAX_PENDING_PER_USER);

  if (pending.length + uploaded.length < FILE_ATTACHMENT_MAX_PENDING_PER_USER) return;

  throw new ConvexError({
    code: 'FILE_ATTACHMENT_TOO_MANY_PENDING',
    message: `At most ${FILE_ATTACHMENT_MAX_PENDING_PER_USER} pending uploads are allowed per user`,
  });
}

/** Rejects a reservation whose size cannot fit in either quota. */
async function assertUploadFitsQuota(
  ctx: MutationCtx,
  chatroom: ResolvedChatroom,
  sizeBytes: number
): Promise<void> {
  const quotas = await resolveFileQuotas(ctx, {
    userId: chatroom.ownerId,
    chatroomId: chatroom._id,
  });
  if (sizeBytes > quotas.effectiveChatroomQuotaBytes || sizeBytes > quotas.userQuotaBytes) {
    throw new ConvexError({
      code: 'FILE_ATTACHMENT_EXCEEDS_QUOTA',
      message: 'Attachment exceeds the available file storage quota',
    });
  }
}

/**
 * Authorizes an upload POST before any bytes are read or stored.
 *
 * Validates the session, resolves the ticket, checks chatroom access and
 * ownership, and confirms the ticket is still a live `pending_upload`.
 */
export async function authorizeFileUpload(
  ctx: QueryCtx,
  args: { sessionId: string; rawAttachmentId: string; now: number }
): Promise<AuthorizeUploadResult> {
  const resolved = await resolveAuthorizedRow(ctx, args.sessionId, args.rawAttachmentId);
  if (!resolved.ok) return resolved;

  const stateError = assertTicketState(resolved.row, args.now);
  if (stateError) return stateError;

  return {
    ok: true,
    row: resolved.row,
    sizeBytes: resolved.row.sizeBytes,
    storedContentType: getStoredBlobContentType(resolved.row.mimeType as FileAttachmentMimeType),
  };
}

/**
 * Loads the ticket and enforces session, chatroom, and ownership access.
 * This is the full access gate used by both authorize and complete.
 */
async function resolveAuthorizedRow(
  ctx: QueryCtx,
  sessionId: string,
  rawAttachmentId: string
): Promise<{ ok: true; row: Doc<'chatroom_fileAttachments'> } | AuthorizeUploadFailure> {
  const attachmentId = ctx.db.normalizeId('chatroom_fileAttachments', rawAttachmentId);
  if (!attachmentId) {
    return errorResult(400, 'FILE_ATTACHMENT_INVALID', 'Attachment id is malformed');
  }
  return await resolveAuthorizedAttachment(ctx, sessionId, attachmentId);
}

/** Validates the session and requires the caller to own the attachment. */
async function resolveAuthorizedAttachment(
  ctx: QueryCtx,
  sessionId: string,
  attachmentId: Id<'chatroom_fileAttachments'>
): Promise<{ ok: true; row: Doc<'chatroom_fileAttachments'> } | AuthorizeUploadFailure> {
  const session = await validateSession(ctx, sessionId);
  if (!session.ok) {
    return errorResult(401, 'AUTH_FAILED', `Authentication failed: ${session.reason}`);
  }

  const row = await ctx.db.get('chatroom_fileAttachments', attachmentId);
  if (!row) {
    return errorResult(404, 'FILE_ATTACHMENT_NOT_FOUND', 'Attachment not found');
  }

  const access = await getChatroomAccess(ctx, sessionId, row.chatroomId);
  if (!ownsAttachment(access, session.userId, row)) {
    return errorResult(403, 'ACCESS_DENIED', 'You do not have access to this attachment');
  }

  return { ok: true, row };
}

/** True when the caller has chatroom access and owns the attachment row. */
function ownsAttachment(
  access: Awaited<ReturnType<typeof getChatroomAccess>>,
  userId: Id<'users'>,
  row: Doc<'chatroom_fileAttachments'>
): boolean {
  return access !== null && access.userId === userId && row.ownerUserId === userId;
}

/** Rejects tickets that are no longer a live `pending_upload`. */
function assertTicketState(
  row: Doc<'chatroom_fileAttachments'>,
  now: number
): AuthorizeUploadFailure | null {
  if (row.status !== 'pending_upload' || row.expiresAt === undefined || row.expiresAt <= now) {
    return errorResult(
      409,
      'FILE_ATTACHMENT_INVALID_STATE',
      'Attachment upload ticket is no longer valid'
    );
  }
  return null;
}

/**
 * Completes an upload after the HTTP action stored the blob.
 *
 * Re-runs every authorization check inside the transaction, verifies the blob
 * size against the reserved size, re-checks quota with current usage, then
 * flips the row to `uploaded` and increments usage.
 *
 * On `FILE_ATTACHMENT_EXCEEDS_QUOTA` the caller (HTTP action) deletes the blob.
 */
export async function completeFileUpload(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    rawAttachmentId: string;
    storageId: Id<'_storage'>;
    now: number;
  }
): Promise<AuthorizeUploadResult> {
  const auth = await authorizeFileUpload(ctx, args);
  if (!auth.ok) return auth;

  const row = auth.row;

  const blobError = await assertBlobMatchesReservation(ctx, args.storageId, row.sizeBytes);
  if (blobError) return blobError;

  const quotaError = await assertCompletionWithinQuota(ctx, row);
  if (quotaError) return quotaError;

  await ctx.db.patch('chatroom_fileAttachments', row._id, {
    status: 'uploaded',
    storageId: args.storageId,
    uploadedAt: args.now,
    expiresAt: args.now + UPLOADED_UNATTACHED_TTL_MS,
  });

  await applyFileUsageDelta(ctx, {
    userId: row.ownerUserId,
    deltas: [{ chatroomId: row.chatroomId, bytes: row.sizeBytes, files: 1 }],
  });

  return auth;
}

/** Enforces invariant I4: the stored blob size equals the reservation. */
async function assertBlobMatchesReservation(
  ctx: MutationCtx,
  storageId: Id<'_storage'>,
  sizeBytes: number
): Promise<AuthorizeUploadFailure | null> {
  const blob = await ctx.db.system.get('_storage', storageId);
  if (!blob || blob.size !== sizeBytes) {
    return errorResult(
      400,
      'FILE_ATTACHMENT_INVALID',
      'Uploaded bytes do not match the reservation'
    );
  }
  return null;
}

/** Re-checks both quotas against current usage before counting the upload. */
async function assertCompletionWithinQuota(
  ctx: MutationCtx,
  row: Doc<'chatroom_fileAttachments'>
): Promise<AuthorizeUploadFailure | null> {
  const quotas = await resolveFileQuotas(ctx, {
    userId: row.ownerUserId,
    chatroomId: row.chatroomId,
  });
  const userUsage = await readScopeBytes(ctx, row.ownerUserId, undefined);
  const chatroomUsage = await readScopeBytes(ctx, row.ownerUserId, row.chatroomId);
  if (
    userUsage + row.sizeBytes > quotas.userQuotaBytes ||
    chatroomUsage + row.sizeBytes > quotas.effectiveChatroomQuotaBytes
  ) {
    return errorResult(
      409,
      'FILE_ATTACHMENT_EXCEEDS_QUOTA',
      'Attachment no longer fits in the available file storage quota'
    );
  }
  return null;
}

/** Reads the current byte counter for one usage scope; absent = 0. */
async function readScopeBytes(
  ctx: QueryCtx,
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'> | undefined
): Promise<number> {
  const row = await ctx.db
    .query('chatroom_fileStorageUsage')
    .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', chatroomId))
    .unique();
  return row?.bytes ?? 0;
}

/** Builds a failed authorize/complete result. */
function errorResult(
  status: 400 | 401 | 403 | 404 | 409,
  code: BackendErrorCode,
  message: string
): AuthorizeUploadFailure {
  return { ok: false, status, code, message };
}

/** Outcome of pre-write handoff attachment validation. */
export type ValidateHandoffAttachmentsResult =
  | { ok: true; rows: Doc<'chatroom_fileAttachments'>[] }
  | {
      ok: false;
      code: 'FILE_ATTACHMENT_LIMIT_EXCEEDED' | 'FILE_ATTACHMENT_INVALID';
      message: string;
    };

type HandoffAttachmentFailure = Extract<ValidateHandoffAttachmentsResult, { ok: false }>;

/**
 * Validates the uploaded files a handoff intends to bind, without writing.
 *
 * This must run before any handoff write so the mutation commits nothing when
 * an attachment is invalid. Rows come back in the caller-supplied order; the
 * message stores that order verbatim.
 */
export async function validateHandoffAttachments(
  ctx: QueryCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    attachmentIds: Id<'chatroom_fileAttachments'>[];
    now: number;
  }
): Promise<ValidateHandoffAttachmentsResult> {
  const countError = checkHandoffAttachmentCount(args.attachmentIds);
  if (countError) return countError;

  const duplicateError = checkDuplicateAttachmentId(args.attachmentIds);
  if (duplicateError) return duplicateError;

  return await validateHandoffAttachmentRows(ctx, args);
}

/** Rejects a batch larger than one handoff may carry. */
function checkHandoffAttachmentCount(
  attachmentIds: Id<'chatroom_fileAttachments'>[]
): HandoffAttachmentFailure | null {
  if (attachmentIds.length > FILE_ATTACHMENT_MAX_PER_HANDOFF) {
    return invalid(
      'FILE_ATTACHMENT_LIMIT_EXCEEDED',
      `At most ${FILE_ATTACHMENT_MAX_PER_HANDOFF} files can be attached to one handoff`
    );
  }
  return null;
}

/** Rejects the first attachment id that appears twice. */
function checkDuplicateAttachmentId(
  attachmentIds: Id<'chatroom_fileAttachments'>[]
): HandoffAttachmentFailure | null {
  const seen = new Set<string>();
  for (const attachmentId of attachmentIds) {
    if (seen.has(attachmentId)) {
      return invalid('FILE_ATTACHMENT_INVALID', `Duplicate attachment id: ${attachmentId}`);
    }
    seen.add(attachmentId);
  }
  return null;
}

/** Loads and validates every row in caller-supplied order. */
async function validateHandoffAttachmentRows(
  ctx: QueryCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    senderRole: string;
    attachmentIds: Id<'chatroom_fileAttachments'>[];
    now: number;
  }
): Promise<ValidateHandoffAttachmentsResult> {
  const normalizedSenderRole = args.senderRole.toLowerCase();
  const rows: Doc<'chatroom_fileAttachments'>[] = [];
  for (const attachmentId of args.attachmentIds) {
    const resolved = await resolveHandoffAttachmentRow(
      ctx,
      args,
      normalizedSenderRole,
      attachmentId
    );
    if (!resolved.ok) return resolved;
    rows.push(resolved.row);
  }
  return { ok: true, rows };
}

/** Resolves one attachment row or the first reason it cannot be bound. */
async function resolveHandoffAttachmentRow(
  ctx: QueryCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; now: number },
  normalizedSenderRole: string,
  attachmentId: Id<'chatroom_fileAttachments'>
): Promise<{ ok: true; row: Doc<'chatroom_fileAttachments'> } | HandoffAttachmentFailure> {
  const row = await ctx.db.get('chatroom_fileAttachments', attachmentId);
  if (!row) {
    return invalid('FILE_ATTACHMENT_INVALID', `Attachment not found: ${attachmentId}`);
  }

  const rowError = checkHandoffAttachmentRow(row, args, normalizedSenderRole, attachmentId);
  if (rowError) return rowError;

  return { ok: true, row };
}

/** Rejects a row bound to another chatroom, role, or lifecycle state. */
function checkHandoffAttachmentRow(
  row: Doc<'chatroom_fileAttachments'>,
  args: { chatroomId: Id<'chatroom_rooms'>; now: number },
  normalizedSenderRole: string,
  attachmentId: Id<'chatroom_fileAttachments'>
): HandoffAttachmentFailure | null {
  const bindingError = checkAttachmentBinding(
    row,
    args.chatroomId,
    normalizedSenderRole,
    attachmentId
  );
  if (bindingError) return bindingError;
  return checkAttachmentReadyForHandoff(row, attachmentId, args.now);
}

/** Rejects a row that belongs to another chatroom or uploader role. */
function checkAttachmentBinding(
  row: Doc<'chatroom_fileAttachments'>,
  chatroomId: Id<'chatroom_rooms'>,
  normalizedSenderRole: string,
  attachmentId: Id<'chatroom_fileAttachments'>
): HandoffAttachmentFailure | null {
  if (row.chatroomId !== chatroomId) {
    return invalid(
      'FILE_ATTACHMENT_INVALID',
      `Attachment ${attachmentId} does not belong to this chatroom`
    );
  }
  if (row.uploadedByRole !== normalizedSenderRole) {
    return invalid(
      'FILE_ATTACHMENT_INVALID',
      `Attachment ${attachmentId} was not uploaded by role "${normalizedSenderRole}"`
    );
  }
  return null;
}

/** Rejects a row that is not an uploaded, unexpired ticket. */
function checkAttachmentReadyForHandoff(
  row: Doc<'chatroom_fileAttachments'>,
  attachmentId: Id<'chatroom_fileAttachments'>,
  now: number
): HandoffAttachmentFailure | null {
  if (row.status !== 'uploaded') {
    return invalid('FILE_ATTACHMENT_INVALID', `Attachment ${attachmentId} is not awaiting handoff`);
  }
  if (row.expiresAt === undefined || row.expiresAt <= now) {
    return invalid('FILE_ATTACHMENT_INVALID', `Attachment ${attachmentId} has expired`);
  }
  return null;
}

/**
 * Binds validated `uploaded` rows to a handoff message.
 *
 * Status-only change: `uploaded` → `attached` keeps the same bytes counted, so
 * usage is untouched (I3). `expiresAt` is cleared because attached rows live
 * with their message instead of expiring.
 */
export async function bindHandoffAttachments(
  ctx: MutationCtx,
  args: { rows: Doc<'chatroom_fileAttachments'>[]; messageId: Id<'chatroom_messages'>; now: number }
): Promise<void> {
  for (const row of args.rows) {
    await ctx.db.patch('chatroom_fileAttachments', row._id, {
      status: 'attached',
      messageId: args.messageId,
      attachedAt: args.now,
      expiresAt: undefined,
    });
  }

  const first = args.rows[0];
  if (!first) return;
  await scheduleQuotaEnforcementIfExceeded(ctx, {
    userId: first.ownerUserId,
    chatroomId: first.chatroomId,
  });
}

/**
 * Schedules oldest-first eviction when binding left either scope over quota.
 *
 * Binding itself never changes usage (I3), but a quota may have been lowered
 * between upload and bind, so the check runs after every bind batch. Eviction
 * is deferred to a bounded, self-rescheduling internal mutation.
 */
async function scheduleQuotaEnforcementIfExceeded(
  ctx: MutationCtx,
  args: { userId: Id<'users'>; chatroomId: Id<'chatroom_rooms'> }
): Promise<void> {
  const quotas = await resolveFileQuotas(ctx, args);
  const chatroomUsage = await getFileUsage(ctx, {
    userId: args.userId,
    chatroomId: args.chatroomId,
  });
  const userUsage = await getFileUsage(ctx, { userId: args.userId });

  if (
    chatroomUsage.bytes > quotas.effectiveChatroomQuotaBytes ||
    userUsage.bytes > quotas.userQuotaBytes
  ) {
    await ctx.scheduler.runAfter(0, internal.fileAttachments.enforceQuota, args);
  }
}

/** Builds a failed handoff-attachment validation result. */
function invalid(
  code: HandoffAttachmentFailure['code'],
  message: string
): HandoffAttachmentFailure {
  return { ok: false, code, message };
}

/**
 * Golden-path deletion for one attachment: row, blob (when present), then the
 * usage decrement for counted statuses.
 *
 * Delegates to the batch path so there is exactly one deletion implementation.
 */
export async function deleteFileAttachment(
  ctx: MutationCtx,
  row: Doc<'chatroom_fileAttachments'>
): Promise<number> {
  return await deleteFileAttachments(ctx, [row]);
}

/**
 * Deletes many attachments while aggregating usage into one delta call per
 * owner. Each row still runs the same row+blob steps as the single-row path.
 *
 * Rows must be live documents (callers load or select them first); the batch is
 * bounded by the caller's `take`, so a transaction never exceeds Convex limits.
 *
 * @returns the number of rows deleted.
 */
export async function deleteFileAttachments(
  ctx: MutationCtx,
  rows: Doc<'chatroom_fileAttachments'>[]
): Promise<number> {
  if (rows.length === 0) return 0;

  const deltasByOwner = collectUsageDeltas(rows);
  for (const row of rows) {
    await deleteRowAndBlob(ctx, row);
  }

  for (const [userId, perChatroom] of deltasByOwner) {
    await applyFileUsageDelta(ctx, {
      userId,
      deltas: [...perChatroom].map(([chatroomId, delta]) => ({ chatroomId, ...delta })),
    });
  }

  return rows.length;
}

/**
 * Aggregates the negative usage deltas of deleted rows per owner and chatroom.
 * Non-counted statuses contribute nothing.
 */
function collectUsageDeltas(
  rows: Doc<'chatroom_fileAttachments'>[]
): Map<Id<'users'>, Map<Id<'chatroom_rooms'>, { bytes: number; files: number }>> {
  const deltasByOwner = new Map<
    Id<'users'>,
    Map<Id<'chatroom_rooms'>, { bytes: number; files: number }>
  >();

  for (const row of rows) {
    if (!countsTowardUsage(row)) continue;
    addUsageDelta(deltasByOwner, row);
  }

  return deltasByOwner;
}

/** Uploaded and attached rows are the only statuses counted toward usage. */
function countsTowardUsage(row: Doc<'chatroom_fileAttachments'>): boolean {
  return row.status === 'uploaded' || row.status === 'attached';
}

/** Subtracts one deleted row from its owner and chatroom totals. */
function addUsageDelta(
  deltasByOwner: Map<Id<'users'>, Map<Id<'chatroom_rooms'>, { bytes: number; files: number }>>,
  row: Doc<'chatroom_fileAttachments'>
): void {
  const perChatroom = deltasByOwner.get(row.ownerUserId) ?? new Map();
  const existing = perChatroom.get(row.chatroomId) ?? { bytes: 0, files: 0 };
  existing.bytes -= row.sizeBytes;
  existing.files -= 1;
  perChatroom.set(row.chatroomId, existing);
  deltasByOwner.set(row.ownerUserId, perChatroom);
}

/** Removes the row and its blob, tolerating an already-deleted blob. */
async function deleteRowAndBlob(
  ctx: MutationCtx,
  row: Doc<'chatroom_fileAttachments'>
): Promise<void> {
  await ctx.db.delete('chatroom_fileAttachments', row._id);
  if (row.storageId && (await ctx.db.system.get('_storage', row.storageId))) {
    await ctx.storage.delete(row.storageId);
  }
}
