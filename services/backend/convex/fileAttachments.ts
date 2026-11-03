/**
 * File attachment endpoints — upload reservation, upload completion via HTTP,
 * discard, and expiry.
 *
 * The upload HTTP action is the only place a blob is created. It authorizes the
 * ticket first, stores client bytes only after size/ownership checks, and binds
 * the blob through an internal mutation. If binding fails the blob is deleted,
 * so a rejected POST never leaves `_storage` residue.
 */

import {
  FILE_ATTACHMENT_MAX_BYTES,
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
  FILE_ATTACHMENT_UPLOAD_PATH,
} from '@workspace/shared/domain/file-attachment';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { httpAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { validateSession } from './auth/sessionValidation';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import type { BackendErrorCode } from '../config/errorCodes';
import { FILE_LIST_PAGE_MAX } from '../src/domain/entities/file-attachment';
import {
  authorizeFileUpload,
  beginFileUpload,
  completeFileUpload,
  deleteFileAttachment,
  deleteFileAttachments,
} from '../src/domain/usecase/file-attachment/lifecycle';
import {
  evictOverQuotaBatch,
  expireStaleUploadsBatch,
  purgeFilesBatch,
} from '../src/domain/usecase/file-attachment/purge';

/** Header carrying the reserved attachment id on the upload POST. */
const ATTACHMENT_ID_HEADER = 'X-Chatroom-Attachment-Id';

/** Header content type used by every JSON response from the upload action. */
const JSON_CONTENT_TYPE = 'application/json';

/** Reserves an attachment row and returns the upload URL for its bytes. */
export const beginUpload = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    filename: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const { chatroom: authorizedChatroom } = await requireChatroomAccess(
      ctx,
      args.sessionId,
      args.chatroomId
    );
    const chatroom = await withActiveTeamStructure(ctx, authorizedChatroom);
    const siteUrl = requireSiteUrl();

    const { attachmentId, expiresAt } = await beginFileUpload(ctx, {
      chatroom,
      senderRole: args.senderRole,
      filename: args.filename,
      sizeBytes: args.sizeBytes,
      now: Date.now(),
    });

    return {
      attachmentId,
      uploadUrl: `${siteUrl}${FILE_ATTACHMENT_UPLOAD_PATH}`,
      expiresAt,
    };
  },
});

/** Discards the caller's unbound uploads and their blobs. */
export const discardUploads = mutation({
  args: {
    ...SessionIdArg,
    attachmentIds: v.array(v.id('chatroom_fileAttachments')),
  },
  handler: async (ctx, args) => {
    assertDiscardBatchSize(args.attachmentIds.length);

    const session = await validateSession(ctx, args.sessionId);
    if (!session.ok) {
      throw new ConvexError({
        code: 'AUTH_FAILED',
        message: `Authentication failed: ${session.reason}`,
      });
    }

    const rows = await collectDiscardableRows(ctx, session.userId, args.attachmentIds);
    await deleteFileAttachments(ctx, rows);
    return { discarded: rows.length };
  },
});

/** Enforces the per-call discard cap before any database reads. */
function assertDiscardBatchSize(count: number): void {
  if (count <= FILE_ATTACHMENT_MAX_PER_HANDOFF) return;
  throw new ConvexError({
    code: 'VALIDATION_ERROR',
    message: `At most ${FILE_ATTACHMENT_MAX_PER_HANDOFF} attachments can be discarded at once`,
    fields: ['attachmentIds'],
  });
}

/** Collects the caller's rows that are still discardable. */
// fallow-ignore-next-line complexity
async function collectDiscardableRows(
  ctx: MutationCtx,
  userId: Id<'users'>,
  attachmentIds: Id<'chatroom_fileAttachments'>[]
): Promise<Doc<'chatroom_fileAttachments'>[]> {
  const rows: Doc<'chatroom_fileAttachments'>[] = [];
  for (const attachmentId of attachmentIds) {
    const row = await ctx.db.get('chatroom_fileAttachments', attachmentId);
    if (!row || row.ownerUserId !== userId || row.status === 'attached') continue;
    rows.push(row);
  }
  return rows;
}

/** Validates an upload ticket before the HTTP action reads any bytes. */
export const authorizeUpload = internalQuery({
  args: { sessionId: v.string(), attachmentId: v.string() },
  handler: (ctx, args) =>
    authorizeFileUpload(ctx, {
      sessionId: args.sessionId,
      rawAttachmentId: args.attachmentId,
      now: Date.now(),
    }),
});

/**
 * Binds a freshly stored blob to its ticket.
 *
 * Returns a failed result rather than deleting the blob; the HTTP action owns
 * blob cleanup so every rejection path is visible in one place.
 */
export const completeUpload = internalMutation({
  args: {
    sessionId: v.string(),
    attachmentId: v.string(),
    storageId: v.id('_storage'),
  },
  handler: (ctx, args) =>
    completeFileUpload(ctx, {
      sessionId: args.sessionId,
      rawAttachmentId: args.attachmentId,
      storageId: args.storageId,
      now: Date.now(),
    }),
});

/** Expires stale unbound uploads and reschedules while a full batch remains. */
export const expireStaleUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result = await expireStaleUploadsBatch(ctx, Date.now());
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.fileAttachments.expireStaleUploads, {});
    }
  },
});

/**
 * POST /chatroom/file-attachments/upload
 *
 * Required headers:
 * - `Authorization: Bearer <sessionId>`
 * - `X-Chatroom-Attachment-Id: <attachmentId>`
 *
 * Body: raw file bytes. Every response is JSON `{ ok, ... }`.
 */
export const uploadFileAttachmentHttp = httpAction(async (ctx, request) => {
  const preflight = preflightUpload(request);
  if (!preflight.ok) return preflight.response;

  const auth = await ctx.runQuery(internal.fileAttachments.authorizeUpload, {
    sessionId: preflight.sessionId,
    attachmentId: preflight.attachmentId,
  });
  if (!auth.ok) {
    return jsonResponse(auth.status, { ok: false, code: auth.code, message: auth.message });
  }

  const body = await readUploadBody(request, auth.sizeBytes);
  if (!body.ok) return body.response;

  const storageId = await ctx.storage.store(
    new Blob([body.bytes], { type: auth.storedContentType })
  );
  return await bindStoredBlob(ctx, {
    sessionId: preflight.sessionId,
    attachmentId: preflight.attachmentId,
    storageId,
    sizeBytes: auth.sizeBytes,
  });
});

type PreflightResult =
  { ok: true; sessionId: string; attachmentId: string } | { ok: false; response: Response };

/** Validates headers and rejects oversized bodies before reading them. */
// fallow-ignore-next-line complexity
function preflightUpload(request: Request): PreflightResult {
  const sessionId = parseBearerToken(request.headers.get('Authorization'));
  if (!sessionId) {
    return preflightFailure(401, 'UNAUTHORIZED', 'Missing or malformed Authorization bearer token');
  }

  const attachmentId = request.headers.get(ATTACHMENT_ID_HEADER);
  if (!attachmentId) {
    return preflightFailure(
      400,
      'FILE_ATTACHMENT_INVALID',
      `Missing ${ATTACHMENT_ID_HEADER} header`
    );
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > FILE_ATTACHMENT_MAX_BYTES) {
    return preflightFailure(
      413,
      'FILE_ATTACHMENT_TOO_LARGE',
      `Attachment exceeds the maximum size of ${FILE_ATTACHMENT_MAX_BYTES} bytes`
    );
  }

  return { ok: true, sessionId, attachmentId };
}

function preflightFailure(status: number, code: string, message: string): PreflightResult {
  return { ok: false, response: jsonResponse(status, { ok: false, code, message }) };
}

type UploadBodyResult = { ok: true; bytes: ArrayBuffer } | { ok: false; response: Response };

/** Reads the body and enforces the size reserved by the ticket. */
async function readUploadBody(request: Request, expectedSize: number): Promise<UploadBodyResult> {
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return bodyFailure('Could not read the upload body');
  }

  if (bytes.byteLength !== expectedSize) {
    return bodyFailure(`Uploaded ${bytes.byteLength} bytes but ${expectedSize} were reserved`);
  }
  return { ok: true, bytes };
}

function bodyFailure(message: string): UploadBodyResult {
  return {
    ok: false,
    response: jsonResponse(400, { ok: false, code: 'FILE_ATTACHMENT_INVALID', message }),
  };
}

/** Binds the stored blob to its ticket, deleting it on any failure. */
async function bindStoredBlob(
  ctx: ActionCtx,
  args: {
    sessionId: string;
    attachmentId: string;
    storageId: Id<'_storage'>;
    sizeBytes: number;
  }
): Promise<Response> {
  try {
    const result = await ctx.runMutation(internal.fileAttachments.completeUpload, {
      sessionId: args.sessionId,
      attachmentId: args.attachmentId,
      storageId: args.storageId,
    });
    if (!result.ok) {
      await ctx.storage.delete(args.storageId);
      return jsonResponse(result.status, {
        ok: false,
        code: result.code,
        message: result.message,
      });
    }
  } catch (error) {
    await ctx.storage.delete(args.storageId);
    const code = errorCodeOf(error);
    return jsonResponse(statusForCode(code), {
      ok: false,
      code,
      message: 'Could not complete the file upload',
    });
  }

  return jsonResponse(200, {
    ok: true,
    attachmentId: args.attachmentId,
    sizeBytes: args.sizeBytes,
  });
}

/** Returns the deployment's HTTP site URL or fails the mutation. */
function requireSiteUrl(): string {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    throw new ConvexError({
      code: 'FILE_UPLOADS_UNAVAILABLE',
      message: 'File uploads are not available in this deployment',
    });
  }
  return siteUrl;
}

/** `Bearer <token>` → token, or null when absent/malformed. */
function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match?.[1] ?? null;
}

/** Builds a JSON response with the upload endpoint's content type. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
  });
}

/** Extracts a registered error code from a thrown value, else INTERNAL_ERROR. */
function errorCodeOf(error: unknown): BackendErrorCode {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (typeof data?.code === 'string') return data.code as BackendErrorCode;
  }
  return 'INTERNAL_ERROR';
}

const STATUS_BY_CODE: Partial<Record<BackendErrorCode, number>> = {
  FILE_ATTACHMENT_EXCEEDS_QUOTA: 409,
  FILE_ATTACHMENT_INVALID_STATE: 409,
  FILE_ATTACHMENT_NOT_FOUND: 404,
  ACCESS_DENIED: 403,
  AUTH_FAILED: 401,
  UNAUTHORIZED: 401,
  FILE_ATTACHMENT_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

/** Maps a lifecycle failure code onto an HTTP status. */
function statusForCode(code: BackendErrorCode): number {
  return STATUS_BY_CODE[code] ?? 400;
}

// ─── Owner-only access (S5) ────────────────────────────────────────────────

/**
 * Rejects non-web sessions before any chatroom or ownership check.
 *
 * CLI sessions are user-scoped, not chatroom-scoped, so an agent must never be
 * able to read another chatroom's bytes or settings through them.
 */
export function requireWebSession(access: { session: { sessionType: string } }): void {
  if (access.session.sessionType !== 'web') {
    throw new ConvexError({
      code: 'WEB_SESSION_REQUIRED',
      message: 'Files can only be read or managed from the web app.',
    });
  }
}

/** Validates the session and requires the web app as the caller. */
export async function requireWebCaller(
  ctx: QueryCtx | MutationCtx,
  sessionId: string
): Promise<{ userId: Id<'users'>; sessionId: string }> {
  const session = await validateSession(ctx, sessionId);
  if (!session.ok) {
    throw new ConvexError({
      code: 'AUTH_FAILED',
      message: `Authentication failed: ${session.reason}`,
    });
  }
  requireWebSession({ session });
  return { userId: session.userId, sessionId: session.sessionId };
}

/** Rejects a URL request for more than one handoff's worth of attachments. */
function assertUrlBatchSize(count: number): void {
  if (count <= FILE_ATTACHMENT_MAX_PER_HANDOFF) return;
  throw new ConvexError({
    code: 'VALIDATION_ERROR',
    message: `At most ${FILE_ATTACHMENT_MAX_PER_HANDOFF} attachments can be resolved at once`,
    fields: ['attachmentIds'],
  });
}

/**
 * Resolves storage URLs for the caller's attached files.
 *
 * URLs are minted per read from `ctx.storage.getUrl` and never persisted. Rows
 * that are missing or not `attached` resolve to `null`, which is also how a
 * deleted file reads after `deleteFile`.
 */
export const getFileUrls = query({
  args: {
    ...SessionIdArg,
    attachmentIds: v.array(v.id('chatroom_fileAttachments')),
  },
  returns: v.array(
    v.object({
      attachmentId: v.id('chatroom_fileAttachments'),
      url: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    assertUrlBatchSize(args.attachmentIds.length);
    const session = await requireWebCaller(ctx, args.sessionId);

    const rows = await loadOwnedRows(ctx, session.userId, args.attachmentIds);
    await assertRowsChatroomAccess(ctx, args.sessionId, rows);
    return await resolveAttachmentUrls(ctx, args.attachmentIds, rows);
  },
});

/** Loads the requested rows and rejects any row owned by another user. */
async function loadOwnedRows(
  ctx: QueryCtx,
  userId: Id<'users'>,
  attachmentIds: Id<'chatroom_fileAttachments'>[]
): Promise<Map<Id<'chatroom_fileAttachments'>, Doc<'chatroom_fileAttachments'> | null>> {
  const rows = new Map<Id<'chatroom_fileAttachments'>, Doc<'chatroom_fileAttachments'> | null>();
  for (const attachmentId of new Set(attachmentIds)) {
    const row = await ctx.db.get('chatroom_fileAttachments', attachmentId);
    if (row && row.ownerUserId !== userId) {
      throw new ConvexError({
        code: 'ACCESS_DENIED',
        message: 'You do not have access to this attachment',
      });
    }
    rows.set(attachmentId, row);
  }
  return rows;
}

/** Requires chatroom access for every distinct chatroom among the rows. */
async function assertRowsChatroomAccess(
  ctx: QueryCtx,
  sessionId: string,
  rows: Map<Id<'chatroom_fileAttachments'>, Doc<'chatroom_fileAttachments'> | null>
): Promise<void> {
  const chatroomIds = new Set<Id<'chatroom_rooms'>>();
  for (const row of rows.values()) {
    if (row) chatroomIds.add(row.chatroomId);
  }
  for (const chatroomId of chatroomIds) {
    await requireChatroomAccess(ctx, sessionId, chatroomId);
  }
}

/** Mints a URL per attached row; everything else resolves to null. */
async function resolveAttachmentUrls(
  ctx: QueryCtx,
  attachmentIds: Id<'chatroom_fileAttachments'>[],
  rows: Map<Id<'chatroom_fileAttachments'>, Doc<'chatroom_fileAttachments'> | null>
): Promise<{ attachmentId: Id<'chatroom_fileAttachments'>; url: string | null }[]> {
  const result: { attachmentId: Id<'chatroom_fileAttachments'>; url: string | null }[] = [];
  for (const attachmentId of attachmentIds) {
    result.push({ attachmentId, url: await attachedFileUrl(ctx, rows.get(attachmentId) ?? null) });
  }
  return result;
}

/** Storage URL for an attached row with a blob; null otherwise. */
async function attachedFileUrl(
  ctx: QueryCtx,
  row: Doc<'chatroom_fileAttachments'> | null
): Promise<string | null> {
  if (!row || row.status !== 'attached' || !row.storageId) return null;
  return await ctx.storage.getUrl(row.storageId);
}

const fileListItemValidator = v.object({
  _id: v.id('chatroom_fileAttachments'),
  chatroomId: v.id('chatroom_rooms'),
  chatroomName: v.optional(v.string()),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  attachedAt: v.optional(v.number()),
  messageId: v.optional(v.id('chatroom_messages')),
});

/**
 * Lists the caller's attached files, newest/oldest or largest-first.
 *
 * Chatroom scope requires ownership of that chatroom; user scope only ever
 * returns rows the caller owns. Pages are capped at `FILE_LIST_PAGE_MAX`.
 */
export const listFiles = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.optional(v.id('chatroom_rooms')),
    sort: v.union(v.literal('largest'), v.literal('oldest')),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(fileListItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const session = await requireWebCaller(ctx, args.sessionId);
    if (args.chatroomId !== undefined) {
      await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    }

    const numItems = Math.min(Math.max(1, args.paginationOpts.numItems), FILE_LIST_PAGE_MAX);
    const result = await paginateFiles(ctx, args, session.userId, numItems);

    return {
      page: await toFileListPage(ctx, result.page),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Maps attachment rows to the list read model, resolving chatroom names once. */
async function toFileListPage(
  ctx: QueryCtx,
  rows: Doc<'chatroom_fileAttachments'>[]
): Promise<ReturnType<typeof toFileListItem>[]> {
  const chatroomNames = new Map<Id<'chatroom_rooms'>, string | undefined>();
  const page = [];
  for (const row of rows) {
    if (!chatroomNames.has(row.chatroomId)) {
      const chatroom = await ctx.db.get('chatroom_rooms', row.chatroomId);
      chatroomNames.set(row.chatroomId, chatroom?.name);
    }
    page.push(toFileListItem(row, chatroomNames.get(row.chatroomId)));
  }
  return page;
}

/** Builds one list row, omitting absent optional fields. */
function toFileListItem(row: Doc<'chatroom_fileAttachments'>, chatroomName: string | undefined) {
  return {
    _id: row._id,
    chatroomId: row.chatroomId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    ...(chatroomName === undefined ? {} : { chatroomName }),
    ...(row.attachedAt === undefined ? {} : { attachedAt: row.attachedAt }),
    ...(row.messageId === undefined ? {} : { messageId: row.messageId }),
  };
}

/** Paginates attached rows on the index that matches scope and sort order. */
async function paginateFiles(
  ctx: QueryCtx,
  args: {
    chatroomId?: Id<'chatroom_rooms'> | undefined;
    sort: 'largest' | 'oldest';
    paginationOpts: { numItems: number; cursor: string | null };
  },
  userId: Id<'users'>,
  numItems: number
) {
  const paginationOpts = { ...args.paginationOpts, numItems };
  const { chatroomId } = args;

  if (chatroomId !== undefined) {
    if (args.sort === 'largest') {
      return await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_chatroom_status_sizeBytes', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'attached')
        )
        .order('desc')
        .paginate(paginationOpts);
    }
    return await ctx.db
      .query('chatroom_fileAttachments')
      .withIndex('by_chatroom_status_attachedAt', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'attached')
      )
      .order('asc')
      .paginate(paginationOpts);
  }

  if (args.sort === 'largest') {
    return await ctx.db
      .query('chatroom_fileAttachments')
      .withIndex('by_owner_status_sizeBytes', (q) =>
        q.eq('ownerUserId', userId).eq('status', 'attached')
      )
      .order('desc')
      .paginate(paginationOpts);
  }
  return await ctx.db
    .query('chatroom_fileAttachments')
    .withIndex('by_owner_status_attachedAt', (q) =>
      q.eq('ownerUserId', userId).eq('status', 'attached')
    )
    .order('asc')
    .paginate(paginationOpts);
}

/** Deletes one of the caller's attachments through the lifecycle golden path. */
export const deleteFile = mutation({
  args: {
    ...SessionIdArg,
    attachmentId: v.id('chatroom_fileAttachments'),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await requireWebCaller(ctx, args.sessionId);

    const row = await ctx.db.get('chatroom_fileAttachments', args.attachmentId);
    if (!row) return { deleted: false };
    if (row.ownerUserId !== session.userId) {
      throw new ConvexError({
        code: 'ACCESS_DENIED',
        message: 'You do not have access to this attachment',
      });
    }

    await deleteFileAttachment(ctx, row);
    return { deleted: true };
  },
});

/**
 * Purges the caller's attached files, optionally scoped to one chatroom and to
 * files at least `minSizeBytes` large.
 *
 * A full batch schedules `continuePurge` so the mutation stays bounded.
 */
export const purgeFiles = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.optional(v.id('chatroom_rooms')),
    minSizeBytes: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number(), continuing: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await requireWebCaller(ctx, args.sessionId);
    return await runPurgeFiles(ctx, {
      sessionId: args.sessionId,
      userId: session.userId,
      chatroomId: args.chatroomId,
      minSizeBytes: args.minSizeBytes,
    });
  },
});

/** Runs one purge batch and schedules the continuation when it was full. */
async function runPurgeFiles(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    userId: Id<'users'>;
    chatroomId?: Id<'chatroom_rooms'> | undefined;
    minSizeBytes?: number | undefined;
  }
): Promise<{ deleted: number; continuing: boolean }> {
  if (args.chatroomId !== undefined) {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
  }

  const batchArgs = toPurgeBatchArgs(args);
  const result = await purgeFilesBatch(ctx, batchArgs);

  if (result.hasMore) {
    await ctx.scheduler.runAfter(0, internal.fileAttachments.continuePurge, batchArgs);
  }

  return { deleted: result.deleted, continuing: result.hasMore };
}

/** Drops absent optional fields so exactOptionalPropertyTypes stays satisfied. */
function toPurgeBatchArgs(args: {
  userId: Id<'users'>;
  chatroomId?: Id<'chatroom_rooms'> | undefined;
  minSizeBytes?: number | undefined;
}): { userId: Id<'users'>; chatroomId?: Id<'chatroom_rooms'>; minSizeBytes?: number } {
  return {
    userId: args.userId,
    ...(args.chatroomId === undefined ? {} : { chatroomId: args.chatroomId }),
    ...(args.minSizeBytes === undefined ? {} : { minSizeBytes: args.minSizeBytes }),
  };
}

/** Continues a purge until no full batch remains. */
export const continuePurge = internalMutation({
  args: {
    userId: v.id('users'),
    chatroomId: v.optional(v.id('chatroom_rooms')),
    minSizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const result = await purgeFilesBatch(ctx, args);
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.fileAttachments.continuePurge, args);
    }
  },
});

/** Evicts oldest-first until both scopes fit, rescheduling while over. */
export const enforceQuota = internalMutation({
  args: {
    userId: v.id('users'),
    chatroomId: v.optional(v.id('chatroom_rooms')),
  },
  handler: async (ctx, args) => {
    const result = await evictOverQuotaBatch(ctx, args);
    if (result.hasMore) {
      await ctx.scheduler.runAfter(0, internal.fileAttachments.enforceQuota, args);
    }
  },
});
