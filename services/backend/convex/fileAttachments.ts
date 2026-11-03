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
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { httpAction, internalMutation, internalQuery, mutation } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { validateSession } from './auth/sessionValidation';
import { withActiveTeamStructure } from './lib/chatroomTeam';
import type { BackendErrorCode } from '../config/errorCodes';
import {
  authorizeFileUpload,
  beginFileUpload,
  completeFileUpload,
  deleteFileAttachments,
} from '../src/domain/usecase/file-attachment/lifecycle';
import { expireStaleUploadsBatch } from '../src/domain/usecase/file-attachment/purge';

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
    const session = await requireDiscardSession(ctx, args.sessionId, args.attachmentIds.length);
    const rows = await collectDiscardableRows(ctx, session.userId, args.attachmentIds);
    await deleteFileAttachments(ctx, rows);
    return { discarded: rows.length };
  },
});

/** Enforces the batch cap and authenticates the caller. */
async function requireDiscardSession(
  ctx: MutationCtx,
  sessionId: string,
  count: number
): Promise<{ userId: Id<'users'> }> {
  if (count > FILE_ATTACHMENT_MAX_PER_HANDOFF) {
    throw new ConvexError({
      code: 'VALIDATION_ERROR',
      message: `At most ${FILE_ATTACHMENT_MAX_PER_HANDOFF} attachments can be discarded at once`,
      fields: ['attachmentIds'],
    });
  }

  const session = await validateSession(ctx, sessionId);
  if (!session.ok) {
    throw new ConvexError({
      code: 'AUTH_FAILED',
      message: `Authentication failed: ${session.reason}`,
    });
  }
  return { userId: session.userId };
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
