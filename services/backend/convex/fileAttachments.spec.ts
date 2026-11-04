/**
 * File attachment upload lifecycle tests (S2).
 *
 * Covers the upload contract through the real HTTP action (`t.fetch`), ticket
 * validation, blob cleanup on rejection, discard, quota re-checks, and expiry.
 *
 * These tests exercise the real schema and convex-test's in-memory storage; no
 * internal collaborator is mocked. Every scenario finishes by asserting
 * invariant I3 (usage counters match counted attachment rows).
 */

import {
  FILE_ATTACHMENT_MAX_BYTES,
  FILE_ATTACHMENT_MAX_PENDING_PER_USER,
  FILE_ATTACHMENT_MAX_PER_HANDOFF,
  FILE_ATTACHMENT_UPLOAD_PATH,
} from '@workspace/shared/domain/file-attachment';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  FILE_EXPIRY_BATCH_SIZE,
  FILE_LIST_PAGE_MAX,
  PENDING_UPLOAD_TTL_MS,
  UPLOADED_UNATTACHED_TTL_MS,
} from '../src/domain/entities/file-attachment';
import {
  assertUsageInvariant,
  createCliSession,
  getFileUsageRow as getUsage,
  seedAttachedRows,
  setupFileUser as setupUser,
  type FileTestUser as TestUser,
} from '../tests/helpers/fileAttachmentUsage';
import { createDuoTeamChatroom } from '../tests/helpers/integration';

const SITE_URL = 'https://test.site';
const ATTACHMENT_HEADER = 'X-Chatroom-Attachment-Id';

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function beginUpload(
  user: TestUser,
  options: {
    filename?: string;
    sizeBytes?: number;
    senderRole?: string;
    chatroomId?: Id<'chatroom_rooms'>;
  } = {}
) {
  const filename = options.filename ?? 'notes.txt';
  const sizeBytes = options.sizeBytes ?? new TextEncoder().encode('hello').byteLength;
  return await t.mutation(api.fileAttachments.beginUpload, {
    sessionId: user.sessionId,
    chatroomId: options.chatroomId ?? user.chatroomId,
    senderRole: options.senderRole ?? 'planner',
    filename,
    sizeBytes,
  });
}

function bodyByteLength(body: Uint8Array | string): number {
  return typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
}

function uploadInit(args: {
  sessionId?: string | null;
  attachmentId?: string | null;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}): RequestInit {
  const body = args.body ?? new TextEncoder().encode('hello');
  // The real CLI sends a known-length Buffer/Uint8Array, so the transport sets
  // Content-Length. convex-test builds the Request directly, so mirror it here.
  const headers: Record<string, string> = {
    'Content-Length': String(bodyByteLength(body)),
    ...args.headers,
  };
  if (args.sessionId !== null) {
    headers.Authorization = `Bearer ${args.sessionId}`;
  }
  if (args.attachmentId !== null) {
    headers[ATTACHMENT_HEADER] = args.attachmentId ?? '';
  }
  return {
    method: 'POST',
    headers,
    body,
  };
}

async function postUpload(
  user: TestUser,
  attachmentId: string,
  args: {
    sessionId?: string | null;
    body?: Uint8Array | string;
    headers?: Record<string, string>;
  } = {}
) {
  return await t.fetch(
    FILE_ATTACHMENT_UPLOAD_PATH,
    uploadInit({
      sessionId: args.sessionId === undefined ? user.sessionId : args.sessionId,
      attachmentId,
      body: args.body,
      headers: args.headers,
    })
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function countStorage(): Promise<number> {
  return await t.run(async (ctx) => {
    const docs = await ctx.db.system.query('_storage').collect();
    return docs.length;
  });
}

async function getRow(attachmentId: Id<'chatroom_fileAttachments'>) {
  return await t.run(async (ctx) => ctx.db.get('chatroom_fileAttachments', attachmentId));
}

async function getStorageDoc(storageId: Id<'_storage'>) {
  return await t.run(async (ctx) => ctx.db.system.get('_storage', storageId));
}

async function setChatroomQuota(user: TestUser, quotaBytes: number): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_fileStorageSettings', {
      chatroomId: user.chatroomId,
      quotaBytes,
      updatedBy: user.userId,
      updatedAt: Date.now(),
    });
  });
}

async function patchStatus(
  attachmentId: Id<'chatroom_fileAttachments'>,
  status: 'pending_upload' | 'uploaded' | 'attached'
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_fileAttachments', attachmentId, { status });
  });
}

/**
 * Invariant I3 is asserted through the shared helper (see
 * tests/helpers/fileAttachmentUsage.ts).
 */

async function expectConvexErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError).data).toMatchObject({ code });
}

// ─── beginUpload validation ─────────────────────────────────────────────────

describe('beginUpload validation', () => {
  test('rejects disallowed extensions, unsafe filenames, and bad sizes', async () => {
    const user = await setupUser('begin-invalid');

    await expectConvexErrorCode(
      beginUpload(user, { filename: 'malware.exe' }),
      'FILE_ATTACHMENT_TYPE_NOT_ALLOWED'
    );
    await expectConvexErrorCode(
      beginUpload(user, { filename: 'dir/notes.txt' }),
      'FILE_ATTACHMENT_INVALID_FILENAME'
    );
    await expectConvexErrorCode(beginUpload(user, { sizeBytes: 0 }), 'FILE_ATTACHMENT_INVALID');
    await expectConvexErrorCode(beginUpload(user, { sizeBytes: 1.5 }), 'FILE_ATTACHMENT_INVALID');
    await expectConvexErrorCode(
      beginUpload(user, { sizeBytes: FILE_ATTACHMENT_MAX_BYTES + 1 }),
      'FILE_ATTACHMENT_TOO_LARGE'
    );
  });

  test('rejects the user role and non-team roles', async () => {
    const user = await setupUser('begin-role');

    await expectConvexErrorCode(beginUpload(user, { senderRole: 'user' }), 'ACCESS_DENIED');
    await expectConvexErrorCode(beginUpload(user, { senderRole: 'intruder' }), 'VALIDATION_ERROR');
  });

  test('rejects files larger than the effective chatroom quota', async () => {
    const user = await setupUser('begin-quota');
    await setChatroomQuota(user, 2);

    await expectConvexErrorCode(
      beginUpload(user, { sizeBytes: 3 }),
      'FILE_ATTACHMENT_EXCEEDS_QUOTA'
    );
  });

  test('rejects any upload when the chatroom quota is zero', async () => {
    const user = await setupUser('begin-zero-quota');
    await setChatroomQuota(user, 0);

    await expectConvexErrorCode(
      beginUpload(user, { sizeBytes: 1 }),
      'FILE_ATTACHMENT_EXCEEDS_QUOTA'
    );
  });

  test('fails closed when the site URL is unavailable', async () => {
    const user = await setupUser('begin-no-site');
    vi.stubEnv('CONVEX_SITE_URL', '');

    await expectConvexErrorCode(beginUpload(user), 'FILE_UPLOADS_UNAVAILABLE');

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) => q.eq('ownerUserId', user.userId))
        .collect()
    );
    expect(rows).toHaveLength(0);
  });

  test('returns the site upload URL and a pending ticket', async () => {
    const user = await setupUser('begin-happy');
    const before = Date.now();
    const ticket = await beginUpload(user);

    expect(ticket.uploadUrl).toBe(`${SITE_URL}${FILE_ATTACHMENT_UPLOAD_PATH}`);
    expect(ticket.expiresAt).toBeGreaterThanOrEqual(before + PENDING_UPLOAD_TTL_MS);

    const row = await getRow(ticket.attachmentId);
    expect(row?.status).toBe('pending_upload');
    expect(row?.ownerUserId).toBe(user.userId);
    expect(row?.uploadedByRole).toBe('planner');
    expect(row?.sizeBytes).toBe(5);
    expect(row?.storageId).toBeUndefined();
  });

  test('caps pending uploads per owner without affecting another owner', async () => {
    const user = await setupUser('begin-pending-cap');
    for (let i = 0; i < FILE_ATTACHMENT_MAX_PENDING_PER_USER; i++) {
      await beginUpload(user, { filename: `pending-${i}.txt` });
    }

    await expectConvexErrorCode(
      beginUpload(user, { filename: 'over-cap.txt' }),
      'FILE_ATTACHMENT_TOO_MANY_PENDING'
    );

    const other = await setupUser('begin-pending-cap-other');
    await expect(beginUpload(other)).resolves.toMatchObject({
      attachmentId: expect.any(String),
      uploadUrl: `${SITE_URL}${FILE_ATTACHMENT_UPLOAD_PATH}`,
    });
  });

  test('counts uploaded but unbound rows toward the pending cap', async () => {
    const user = await setupUser('begin-uploaded-cap');
    const uploaded = FILE_ATTACHMENT_MAX_PENDING_PER_USER / 2;
    for (let i = 0; i < uploaded; i++) {
      const ticket = await beginUpload(user, { filename: `uploaded-${i}.txt` });
      const response = await postUpload(user, ticket.attachmentId);
      expect(response.status).toBe(200);
    }
    for (let i = 0; i < uploaded; i++) {
      await beginUpload(user, { filename: `pending-${i}.txt` });
    }

    await expectConvexErrorCode(
      beginUpload(user, { filename: 'over-cap.txt' }),
      'FILE_ATTACHMENT_TOO_MANY_PENDING'
    );
  });
});

// ─── Upload happy path ──────────────────────────────────────────────────────

describe('upload HTTP happy path', () => {
  test('stores the blob, marks the row uploaded, and counts usage', async () => {
    const user = await setupUser('upload-happy');
    const storageBefore = await countStorage();
    const ticket = await beginUpload(user);

    const response = await postUpload(user, ticket.attachmentId);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await readJson(response)).toEqual({
      ok: true,
      attachmentId: ticket.attachmentId,
      sizeBytes: 5,
    });

    const row = await getRow(ticket.attachmentId);
    expect(row?.status).toBe('uploaded');
    expect(row?.storageId).toBeDefined();
    expect(row?.uploadedAt).toBeDefined();
    expect(row?.expiresAt).toBe(row!.uploadedAt! + UPLOADED_UNATTACHED_TTL_MS);

    const blob = await getStorageDoc(row!.storageId!);
    expect(blob?.size).toBe(5);
    expect(await countStorage()).toBe(storageBefore + 1);

    const userUsage = await getUsage(user.userId, undefined);
    const chatroomUsage = await getUsage(user.userId, user.chatroomId);
    expect(userUsage?.bytes).toBe(5);
    expect(userUsage?.fileCount).toBe(1);
    expect(chatroomUsage?.bytes).toBe(5);
    expect(chatroomUsage?.fileCount).toBe(1);

    await assertUsageInvariant(user.userId);
  });

  test('stores active content as application/octet-stream', async () => {
    const user = await setupUser('upload-active-content');

    // convex-test's `_storage` documents do not persist a contentType, so the
    // stored type is asserted at the authorize seam — the exact value the HTTP
    // action passes to `ctx.storage.store`.
    const svg = await beginUpload(user, {
      filename: 'logo.svg',
      sizeBytes: 5,
    });
    const svgAuth = await t.query(internal.fileAttachments.authorizeUpload, {
      sessionId: user.sessionId,
      attachmentId: svg.attachmentId,
    });
    expect(svgAuth).toMatchObject({ ok: true, storedContentType: 'application/octet-stream' });
    const svgResponse = await postUpload(user, svg.attachmentId);
    expect(svgResponse.status).toBe(200);

    const html = await beginUpload(user, {
      filename: 'page.html',
      sizeBytes: 5,
    });
    const htmlAuth = await t.query(internal.fileAttachments.authorizeUpload, {
      sessionId: user.sessionId,
      attachmentId: html.attachmentId,
    });
    expect(htmlAuth).toMatchObject({ ok: true, storedContentType: 'application/octet-stream' });
    const htmlResponse = await postUpload(user, html.attachmentId);
    expect(htmlResponse.status).toBe(200);

    const txt = await beginUpload(user, { filename: 'notes.txt', sizeBytes: 5 });
    const txtAuth = await t.query(internal.fileAttachments.authorizeUpload, {
      sessionId: user.sessionId,
      attachmentId: txt.attachmentId,
    });
    expect(txtAuth).toMatchObject({ ok: true, storedContentType: 'text/plain' });
    const txtResponse = await postUpload(user, txt.attachmentId);
    expect(txtResponse.status).toBe(200);

    await assertUsageInvariant(user.userId);
  });
});

// ─── Upload rejections ──────────────────────────────────────────────────────

describe('upload HTTP rejections', () => {
  test('missing or malformed bearer tokens return 401 with no blob', async () => {
    const user = await setupUser('upload-auth');
    const ticket = await beginUpload(user);
    const storageBefore = await countStorage();

    const missing = await postUpload(user, ticket.attachmentId, { sessionId: null });
    expect(missing.status).toBe(401);
    expect((await readJson(missing)).code).toBe('UNAUTHORIZED');

    const malformed = await t.fetch(
      FILE_ATTACHMENT_UPLOAD_PATH,
      uploadInit({
        sessionId: null,
        attachmentId: ticket.attachmentId,
        headers: { Authorization: `Token ${user.sessionId}` },
      })
    );
    expect(malformed.status).toBe(401);

    expect(await countStorage()).toBe(storageBefore);
    expect((await getRow(ticket.attachmentId))?.status).toBe('pending_upload');
  });

  test("another user's session returns 403 with no blob", async () => {
    const owner = await setupUser('upload-owner');
    const intruder = await setupUser('upload-intruder');
    const ticket = await beginUpload(owner);
    const storageBefore = await countStorage();

    const response = await postUpload(intruder, ticket.attachmentId);
    expect(response.status).toBe(403);
    expect((await readJson(response)).code).toBe('ACCESS_DENIED');
    expect(await countStorage()).toBe(storageBefore);
  });

  test('an oversized Content-Length returns 413 before reading the body', async () => {
    const user = await setupUser('upload-too-large');
    const ticket = await beginUpload(user);
    const storageBefore = await countStorage();

    const response = await postUpload(user, ticket.attachmentId, {
      headers: { 'Content-Length': String(FILE_ATTACHMENT_MAX_BYTES + 1) },
    });
    expect(response.status).toBe(413);
    expect((await readJson(response)).code).toBe('FILE_ATTACHMENT_TOO_LARGE');
    expect(await countStorage()).toBe(storageBefore);
  });

  test('a missing Content-Length returns 411 before the ticket is authorized', async () => {
    const user = await setupUser('upload-missing-content-length');
    const ticket = await beginUpload(user);
    const storageBefore = await countStorage();

    // The attachment id is malformed on purpose: authorizeUpload would answer
    // 400, so a 411 proves preflight ran before any ticket lookup.
    const response = await t.fetch(FILE_ATTACHMENT_UPLOAD_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user.sessionId}`,
        [ATTACHMENT_HEADER]: 'not-an-attachment-id',
      },
      body: new TextEncoder().encode('hello'),
    });

    expect(response.status).toBe(411);
    expect(await readJson(response)).toMatchObject({
      ok: false,
      code: 'FILE_ATTACHMENT_INVALID',
      message: 'Content-Length header is required',
    });
    expect(await countStorage()).toBe(storageBefore);
    expect((await getRow(ticket.attachmentId))?.status).toBe('pending_upload');
  });

  test('a non-numeric Content-Length returns 411', async () => {
    const user = await setupUser('upload-invalid-content-length');
    const ticket = await beginUpload(user);

    const response = await postUpload(user, ticket.attachmentId, {
      headers: { 'Content-Length': 'chunked' },
    });

    expect(response.status).toBe(411);
    expect((await readJson(response)).code).toBe('FILE_ATTACHMENT_INVALID');
    expect((await getRow(ticket.attachmentId))?.status).toBe('pending_upload');
  });

  test('a body size mismatch returns 400 with no blob', async () => {
    const user = await setupUser('upload-mismatch');
    const ticket = await beginUpload(user, { sizeBytes: 5 });
    const storageBefore = await countStorage();

    const response = await postUpload(user, ticket.attachmentId, {
      body: new TextEncoder().encode('hello world'),
    });
    expect(response.status).toBe(400);
    expect((await readJson(response)).code).toBe('FILE_ATTACHMENT_INVALID');
    expect(await countStorage()).toBe(storageBefore);
  });

  test('an expired ticket returns 409 with no blob', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);

    const user = await setupUser('upload-expired-ticket');
    const ticket = await beginUpload(user);
    const storageBefore = await countStorage();

    vi.setSystemTime(now + PENDING_UPLOAD_TTL_MS + 1);
    const response = await postUpload(user, ticket.attachmentId);
    expect(response.status).toBe(409);
    expect((await readJson(response)).code).toBe('FILE_ATTACHMENT_INVALID_STATE');
    expect(await countStorage()).toBe(storageBefore);
  });

  test('a second POST on the same ticket returns 409 and keeps one blob', async () => {
    const user = await setupUser('upload-twice');
    const ticket = await beginUpload(user);
    const storageBefore = await countStorage();

    const first = await postUpload(user, ticket.attachmentId);
    expect(first.status).toBe(200);
    expect(await countStorage()).toBe(storageBefore + 1);

    const second = await postUpload(user, ticket.attachmentId);
    expect(second.status).toBe(409);
    expect((await readJson(second)).code).toBe('FILE_ATTACHMENT_INVALID_STATE');
    expect(await countStorage()).toBe(storageBefore + 1);

    await assertUsageInvariant(user.userId);
  });
});

// ─── Quota re-check at completion ───────────────────────────────────────────

describe('quota re-check at completion', () => {
  test('a second upload that only fits alone is rejected and leaves no blob', async () => {
    const user = await setupUser('quota-race');
    await setChatroomQuota(user, 10);

    const first = await beginUpload(user, { sizeBytes: 6 });
    const firstResponse = await postUpload(user, first.attachmentId, {
      body: new Uint8Array(6).fill(1),
    });
    expect(firstResponse.status).toBe(200);

    const second = await beginUpload(user, { sizeBytes: 6 });
    const storageBefore = await countStorage();
    const secondResponse = await postUpload(user, second.attachmentId, {
      body: new Uint8Array(6).fill(2),
    });
    expect(secondResponse.status).toBe(409);
    expect((await readJson(secondResponse)).code).toBe('FILE_ATTACHMENT_EXCEEDS_QUOTA');
    expect(await countStorage()).toBe(storageBefore);

    const row = await getRow(second.attachmentId);
    expect(row?.status).toBe('pending_upload');
    expect(row?.storageId).toBeUndefined();

    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(6);
    await assertUsageInvariant(user.userId);
  });
});

// ─── discardUploads ─────────────────────────────────────────────────────────

describe('discardUploads', () => {
  test('deletes own unbound rows and blobs, skipping attached and foreign rows', async () => {
    const user = await setupUser('discard-owner');
    const other = await setupUser('discard-other');

    const uploaded = await beginUpload(user, { sizeBytes: 4 });
    expect(
      (await postUpload(user, uploaded.attachmentId, { body: new Uint8Array(4) })).status
    ).toBe(200);

    const pending = await beginUpload(user, { sizeBytes: 2 });

    const attached = await beginUpload(user, { sizeBytes: 3 });
    expect(
      (await postUpload(user, attached.attachmentId, { body: new Uint8Array(3) })).status
    ).toBe(200);
    await patchStatus(attached.attachmentId, 'attached');

    const foreign = await beginUpload(other, { sizeBytes: 2 });
    expect(
      (await postUpload(other, foreign.attachmentId, { body: new Uint8Array(2) })).status
    ).toBe(200);

    const storageBefore = await countStorage();
    const result = await t.mutation(api.fileAttachments.discardUploads, {
      sessionId: user.sessionId,
      attachmentIds: [
        uploaded.attachmentId,
        pending.attachmentId,
        attached.attachmentId,
        foreign.attachmentId,
      ],
    });
    expect(result.discarded).toBe(2);

    expect(await getRow(uploaded.attachmentId)).toBeNull();
    expect(await getRow(pending.attachmentId)).toBeNull();
    expect((await getRow(attached.attachmentId))?.status).toBe('attached');
    expect((await getRow(foreign.attachmentId))?.status).toBe('uploaded');

    // Only the attached and foreign blobs remain; the discarded uploaded blob
    // was removed with its row.
    expect(await countStorage()).toBe(storageBefore - 1);

    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(3);
    expect((await getUsage(other.userId, other.chatroomId))?.bytes).toBe(2);
    await assertUsageInvariant(user.userId);
    await assertUsageInvariant(other.userId);
  });

  test('rejects more than ten ids', async () => {
    const user = await setupUser('discard-too-many');
    const ids = await t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 11 }, () =>
          ctx.db.insert('chatroom_fileAttachments', {
            chatroomId: user.chatroomId,
            ownerUserId: user.userId,
            uploadedByRole: 'planner',
            filename: 'bulk.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
            status: 'pending_upload' as const,
            createdAt: Date.now(),
            expiresAt: Date.now() + PENDING_UPLOAD_TTL_MS,
          })
        )
      )
    );

    await expectConvexErrorCode(
      t.mutation(api.fileAttachments.discardUploads, {
        sessionId: user.sessionId,
        attachmentIds: ids,
      }),
      'VALIDATION_ERROR'
    );
  });
});

// ─── Expiry ─────────────────────────────────────────────────────────────────

describe('expireStaleUploads', () => {
  test('expires pending and uploaded rows but never attached rows', async () => {
    vi.useFakeTimers();
    const now = 1_800_100_000_000;
    vi.setSystemTime(now);

    const user = await setupUser('expiry');

    const pending = await beginUpload(user, { sizeBytes: 2 });

    const uploaded = await beginUpload(user, { sizeBytes: 4 });
    const uploadedResponse = await postUpload(user, uploaded.attachmentId, {
      body: new Uint8Array(4),
    });
    expect(uploadedResponse.status).toBe(200);
    const uploadedBlob = (await getRow(uploaded.attachmentId))!.storageId!;

    const attached = await beginUpload(user, { sizeBytes: 3 });
    const attachedResponse = await postUpload(user, attached.attachmentId, {
      body: new Uint8Array(3),
    });
    expect(attachedResponse.status).toBe(200);
    await patchStatus(attached.attachmentId, 'attached');
    const attachedBlob = (await getRow(attached.attachmentId))!.storageId!;

    vi.setSystemTime(now + UPLOADED_UNATTACHED_TTL_MS + 1);
    await t.mutation(internal.fileAttachments.expireStaleUploads, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await getRow(pending.attachmentId)).toBeNull();
    expect(await getRow(uploaded.attachmentId)).toBeNull();
    expect(await getStorageDoc(uploadedBlob)).toBeNull();
    expect((await getRow(attached.attachmentId))?.status).toBe('attached');
    expect(await getStorageDoc(attachedBlob)).not.toBeNull();

    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(3);
    await assertUsageInvariant(user.userId);
  });

  test('reschedules itself when a full expiry batch is consumed', async () => {
    vi.useFakeTimers();
    const now = 1_800_200_000_000;
    vi.setSystemTime(now);

    const user = await setupUser('expiry-batch');
    const expiredAt = now - 1;

    await t.run(async (ctx) => {
      for (let i = 0; i < FILE_EXPIRY_BATCH_SIZE + 1; i++) {
        await ctx.db.insert('chatroom_fileAttachments', {
          chatroomId: user.chatroomId,
          ownerUserId: user.userId,
          uploadedByRole: 'planner',
          filename: `bulk-${i}.txt`,
          mimeType: 'text/plain',
          sizeBytes: 1,
          status: 'pending_upload' as const,
          createdAt: expiredAt - 1,
          expiresAt: expiredAt,
        });
      }
    });

    await t.mutation(internal.fileAttachments.expireStaleUploads, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) => q.eq('ownerUserId', user.userId))
        .collect()
    );
    expect(remaining).toHaveLength(0);
    await assertUsageInvariant(user.userId);
  });
});

// ─── Handoff binding (S3) ───────────────────────────────────────────────────

/** Uploads one file through the real HTTP action and returns its row id. */
async function uploadFile(
  user: TestUser,
  options: {
    filename?: string;
    sizeBytes?: number;
    senderRole?: string;
    chatroomId?: Id<'chatroom_rooms'>;
  } = {}
): Promise<Id<'chatroom_fileAttachments'>> {
  const sizeBytes = options.sizeBytes ?? 5;
  const ticket = await beginUpload(user, { ...options, sizeBytes });
  const response = await postUpload(user, ticket.attachmentId, {
    body: new TextEncoder().encode('x'.repeat(sizeBytes)),
  });
  expect(response.status).toBe(200);
  return ticket.attachmentId;
}

/** Message / task / attachment state used to prove a rejection wrote nothing. */
async function captureState(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    const attachments = await ctx.db
      .query('chatroom_fileAttachments')
      .withIndex('by_chatroom_status_attachedAt', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return {
      messageIds: messages.map((message) => message._id).sort(),
      attachmentStates: attachments.map((row) => `${row._id}:${row.status}`).sort(),
      taskStates: tasks.map((task) => `${task._id}:${task.status}`).sort(),
    };
  });
}

/** Creates an acknowledged user message plus an in_progress task for planner. */
async function seedPlannerWork(
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<{ userMessageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userMessageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: 'planner',
      type: 'message',
      acknowledgedAt: now,
    });
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'in_progress',
      assignedTo: 'planner',
      sourceMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    });
    return { userMessageId, taskId };
  });
}

describe('handoff binding to user', () => {
  test('binds two uploaded files in the requested order and exposes attachedFiles', async () => {
    const user = await setupUser('handoff-bind');
    const first = await uploadFile(user, { filename: 'notes.txt' });
    const second = await uploadFile(user, { filename: 'report.pdf' });
    const usageBefore = await getUsage(user.userId, undefined);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Here are the files.',
      targetRole: 'user',
      attachedFileIds: [second, first],
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.messageId).toBeTruthy();

    const message = await t.run(async (ctx) => ctx.db.get('chatroom_messages', result.messageId!));
    expect(message?.attachedFileIds).toEqual([second, first]);

    const firstRow = await getRow(first);
    const secondRow = await getRow(second);
    expect(firstRow?.status).toBe('attached');
    expect(secondRow?.status).toBe('attached');
    expect(firstRow?.messageId).toBe(result.messageId);
    expect(secondRow?.messageId).toBe(result.messageId);
    expect(firstRow?.attachedAt).toBeDefined();
    expect(firstRow?.expiresAt).toBeUndefined();

    // Binding is status-only: the counted bytes are unchanged.
    const usageAfter = await getUsage(user.userId, undefined);
    expect(usageAfter?.bytes).toBe(usageBefore?.bytes);
    expect(usageAfter?.fileCount).toBe(usageBefore?.fileCount);

    // A plain message inserted beside the handoff keeps the old read shape.
    const plainMessageId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_messages', {
        chatroomId: user.chatroomId,
        senderRole: 'user',
        content: 'No files here.',
        type: 'message',
      })
    );

    const feed = await t.query(api.messageList.getLatestMessages, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      limit: 20,
    });
    const enriched = feed.messages.find((entry) => entry._id === result.messageId);
    expect(enriched?.attachedFiles).toEqual([
      {
        _id: second,
        status: 'available',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5,
      },
      {
        _id: first,
        status: 'available',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
      },
    ]);
    expect(Object.keys(enriched!.attachedFiles![0]!).sort()).toEqual([
      '_id',
      'filename',
      'mimeType',
      'sizeBytes',
      'status',
    ]);
    expect(enriched!.attachedFiles![0]).not.toHaveProperty('url');

    const plain = feed.messages.find((entry) => entry._id === plainMessageId);
    expect(plain).toBeDefined();
    expect(plain).not.toHaveProperty('attachedFiles');

    await assertUsageInvariant(user.userId);
  });

  test('rejects file attachments on an agent-to-agent handoff without writing', async () => {
    const user = await setupUser('handoff-agent-target');
    const attachmentId = await uploadFile(user);
    const { taskId } = await seedPlannerWork(user.chatroomId, 'Planner work');
    const before = await captureState(user.chatroomId);
    const usageBefore = await getUsage(user.userId, undefined);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Agent handoff with a file.',
      targetRole: 'builder',
      attachedFileIds: [attachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENTS_REQUIRE_USER_TARGET');
    expect(result.completedTaskIds).toEqual([]);
    expect(await captureState(user.chatroomId)).toEqual(before);
    expect((await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId)))?.status).toBe(
      'in_progress'
    );

    const row = await getRow(attachmentId);
    expect(row?.status).toBe('uploaded');
    expect(row?.messageId).toBeUndefined();

    const usageAfter = await getUsage(user.userId, undefined);
    expect(usageAfter?.bytes).toBe(usageBefore?.bytes);
    expect(usageAfter?.fileCount).toBe(usageBefore?.fileCount);

    await assertUsageInvariant(user.userId);
  });
});

describe('handoff attachment validation', () => {
  test('rejects an attachment from another chatroom without writing', async () => {
    const owner = await setupUser('validation-other-chatroom-owner');
    const foreignAttachmentId = await uploadFile(owner);

    const user = await setupUser('validation-other-chatroom');
    const before = await captureState(user.chatroomId);
    const usageBefore = await getUsage(user.userId, undefined);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Foreign file.',
      targetRole: 'user',
      attachedFileIds: [foreignAttachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_INVALID');
    expect(result.completedTaskIds).toEqual([]);
    expect(await captureState(user.chatroomId)).toEqual(before);
    expect((await getRow(foreignAttachmentId))?.status).toBe('uploaded');

    const usageAfter = await getUsage(user.userId, undefined);
    expect(usageAfter?.bytes).toBe(usageBefore?.bytes);
    expect(usageAfter?.fileCount).toBe(usageBefore?.fileCount);

    await assertUsageInvariant(user.userId);
    await assertUsageInvariant(owner.userId);
  });

  test('rejects a file uploaded by another role without writing', async () => {
    const user = await setupUser('validation-sender-role');
    const attachmentId = await uploadFile(user, { senderRole: 'builder' });
    const before = await captureState(user.chatroomId);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Wrong role.',
      targetRole: 'user',
      attachedFileIds: [attachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_INVALID');
    expect(result.error?.message).toContain('not uploaded by role');
    expect(await captureState(user.chatroomId)).toEqual(before);

    await assertUsageInvariant(user.userId);
  });

  test('rejects an already-attached file without writing', async () => {
    const user = await setupUser('validation-attached');
    const attachmentId = await uploadFile(user);
    await patchStatus(attachmentId, 'attached');
    const before = await captureState(user.chatroomId);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Already bound.',
      targetRole: 'user',
      attachedFileIds: [attachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_INVALID');
    expect(result.error?.message).toContain('not awaiting handoff');
    expect(await captureState(user.chatroomId)).toEqual(before);

    await assertUsageInvariant(user.userId);
  });

  test('rejects duplicate ids without writing', async () => {
    const user = await setupUser('validation-duplicate');
    const attachmentId = await uploadFile(user);
    const before = await captureState(user.chatroomId);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Duplicate ids.',
      targetRole: 'user',
      attachedFileIds: [attachmentId, attachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_INVALID');
    expect(result.error?.message).toContain('Duplicate attachment id');
    expect(await captureState(user.chatroomId)).toEqual(before);

    await assertUsageInvariant(user.userId);
  });

  test('rejects more than the per-handoff limit without writing', async () => {
    const user = await setupUser('validation-limit');
    const attachmentIds: Id<'chatroom_fileAttachments'>[] = [];
    for (let i = 0; i < FILE_ATTACHMENT_MAX_PER_HANDOFF + 1; i++) {
      attachmentIds.push(await uploadFile(user, { filename: `file-${i}.txt` }));
    }
    const before = await captureState(user.chatroomId);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Too many files.',
      targetRole: 'user',
      attachedFileIds: attachmentIds,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_LIMIT_EXCEEDED');
    expect(await captureState(user.chatroomId)).toEqual(before);

    await assertUsageInvariant(user.userId);
  });

  test('rejects an expired upload without writing', async () => {
    const user = await setupUser('validation-expired');
    const attachmentId = await uploadFile(user);
    const row = await getRow(attachmentId);
    const before = await captureState(user.chatroomId);

    vi.useFakeTimers();
    vi.setSystemTime(row!.expiresAt!);

    const result = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Expired file.',
      targetRole: 'user',
      attachedFileIds: [attachmentId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FILE_ATTACHMENT_INVALID');
    expect(result.error?.message).toContain('expired');
    expect(await captureState(user.chatroomId)).toEqual(before);

    vi.useRealTimers();
    await assertUsageInvariant(user.userId);
  });
});

describe('handoff replay cleanup', () => {
  test('a retried handoff deletes only the new uploads and keeps the original binding', async () => {
    const user = await setupUser('handoff-replay');
    const { userMessageId } = await seedPlannerWork(
      user.chatroomId,
      'Ship the attachments feature'
    );

    const first = await uploadFile(user, { filename: 'original-a.txt' });
    const second = await uploadFile(user, { filename: 'original-b.txt' });

    const firstResult = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Done — files attached.',
      targetRole: 'user',
      attachedFileIds: [first, second],
    });
    expect(firstResult.success).toBe(true);
    expect(firstResult.attachmentsDiscarded).toBe(false);
    const messageId = firstResult.messageId!;

    const storageAfterFirst = await countStorage();
    const usageAfterFirst = await getUsage(user.userId, undefined);
    expect(usageAfterFirst?.bytes).toBe(10);
    expect(usageAfterFirst?.fileCount).toBe(2);

    const retriedFirst = await uploadFile(user, { filename: 'retry-a.txt' });
    const retriedSecond = await uploadFile(user, { filename: 'retry-b.txt' });
    expect(await countStorage()).toBe(storageAfterFirst + 2);
    expect((await getUsage(user.userId, undefined))?.bytes).toBe(20);

    const replay = await t.mutation(api.messages.handoff, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Done — files attached.',
      targetRole: 'user',
      attachedFileIds: [retriedFirst, retriedSecond],
    });

    expect(replay.success).toBe(true);
    expect(replay.attachmentsDiscarded).toBe(true);
    expect(replay.messageId).toBe(messageId);
    expect(replay.completedTaskIds).toEqual([]);
    expect(replay.newTaskId).toBeNull();
    expect(replay.promotedTaskId).toBeNull();

    // The retried uploads and their blobs are gone; the original blobs remain.
    expect(await getRow(retriedFirst)).toBeNull();
    expect(await getRow(retriedSecond)).toBeNull();
    expect(await countStorage()).toBe(storageAfterFirst);

    const restoredUsage = await getUsage(user.userId, undefined);
    expect(restoredUsage?.bytes).toBe(usageAfterFirst?.bytes);
    expect(restoredUsage?.fileCount).toBe(usageAfterFirst?.fileCount);

    // The original message and its bound rows are untouched.
    const message = await t.run(async (ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(message?.attachedFileIds).toEqual([first, second]);
    expect((await getRow(first))?.messageId).toBe(messageId);
    expect((await getRow(second))?.messageId).toBe(messageId);
    expect((await getRow(first))?.status).toBe('attached');
    expect((await getRow(second))?.status).toBe('attached');

    const terminalHandoffs = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom_terminalHandoffKey', (q) =>
          q
            .eq('chatroomId', user.chatroomId)
            .eq('terminalHandoffKey', `${user.chatroomId}:${userMessageId}:planner:user`)
        )
        .collect()
    );
    expect(terminalHandoffs).toHaveLength(1);
    expect(terminalHandoffs[0]!._id).toBe(messageId);

    await assertUsageInvariant(user.userId);
  });

  test('a retried handoff without files reports nothing discarded', async () => {
    const user = await setupUser('handoff-replay-no-files');
    await seedPlannerWork(user.chatroomId, 'Retry the same terminal handoff');

    const request = {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      senderRole: 'planner',
      content: 'Done — no files this time.',
      targetRole: 'user',
    };

    const first = await t.mutation(api.messages.handoff, request);
    expect(first.success).toBe(true);
    expect(first.attachmentsDiscarded).toBe(false);

    const replay = await t.mutation(api.messages.handoff, request);
    expect(replay.success).toBe(true);
    expect(replay.messageId).toBe(first.messageId);
    expect(replay.attachmentsDiscarded).toBe(false);

    await assertUsageInvariant(user.userId);
  });
});

// ─── Access and management (S5) ─────────────────────────────────────────────

const MiB = 1024 * 1024;

/** Binds files to a fresh user-addressed handoff in the given chatroom. */
async function bindFiles(
  user: TestUser,
  attachmentIds: Id<'chatroom_fileAttachments'>[],
  label = 'Files attached',
  chatroomId: Id<'chatroom_rooms'> = user.chatroomId
): Promise<Id<'chatroom_messages'>> {
  await seedPlannerWork(chatroomId, label);
  const result = await t.mutation(api.messages.handoff, {
    sessionId: user.sessionId,
    chatroomId,
    senderRole: 'planner',
    content: label,
    targetRole: 'user',
    attachedFileIds: attachmentIds,
  });
  expect(result.success).toBe(true);
  return result.messageId!;
}

async function countAttachedRows(chatroomId: Id<'chatroom_rooms'>): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_fileAttachments')
      .withIndex('by_chatroom_status_attachedAt', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'attached')
      )
      .collect();
    return rows.length;
  });
}

describe('getFileUrls (scenario 8)', () => {
  test('returns a storage URL to the owner web session', async () => {
    const user = await setupUser('urls-owner');
    const attachmentId = await uploadFile(user);
    await bindFiles(user, [attachmentId]);

    const urls = await t.query(api.fileAttachments.getFileUrls, {
      sessionId: user.sessionId,
      attachmentIds: [attachmentId],
    });

    expect(urls).toHaveLength(1);
    expect(urls[0]!.attachmentId).toBe(attachmentId);
    expect(urls[0]!.url).toMatch(/\/api\/storage\//);

    await assertUsageInvariant(user.userId);
  });

  test('rejects a CLI session with WEB_SESSION_REQUIRED', async () => {
    const user = await setupUser('urls-cli');
    const attachmentId = await uploadFile(user);
    await bindFiles(user, [attachmentId]);
    const cliSessionId = await createCliSession(user);

    await expectConvexErrorCode(
      t.query(api.fileAttachments.getFileUrls, {
        sessionId: cliSessionId,
        attachmentIds: [attachmentId],
      }),
      'WEB_SESSION_REQUIRED'
    );

    await assertUsageInvariant(user.userId);
  });

  test("rejects another user's file with ACCESS_DENIED", async () => {
    const owner = await setupUser('urls-owner-denied');
    const other = await setupUser('urls-other-denied');
    const attachmentId = await uploadFile(owner);
    await bindFiles(owner, [attachmentId]);

    await expectConvexErrorCode(
      t.query(api.fileAttachments.getFileUrls, {
        sessionId: other.sessionId,
        attachmentIds: [attachmentId],
      }),
      'ACCESS_DENIED'
    );

    await assertUsageInvariant(owner.userId);
    await assertUsageInvariant(other.userId);
  });

  test('returns null for a deleted row and for an uploaded (not attached) row', async () => {
    const user = await setupUser('urls-null');
    const deletedAttachmentId = await uploadFile(user);
    await bindFiles(user, [deletedAttachmentId]);
    await t.mutation(api.fileAttachments.deleteFile, {
      sessionId: user.sessionId,
      attachmentId: deletedAttachmentId,
    });

    const uploadedAttachmentId = await uploadFile(user);

    const urls = await t.query(api.fileAttachments.getFileUrls, {
      sessionId: user.sessionId,
      attachmentIds: [deletedAttachmentId, uploadedAttachmentId],
    });

    expect(urls).toEqual([
      { attachmentId: deletedAttachmentId, url: null },
      { attachmentId: uploadedAttachmentId, url: null },
    ]);

    await assertUsageInvariant(user.userId);
  });

  test('rejects more than ten ids', async () => {
    const user = await setupUser('urls-too-many');
    const ids = await t.run(async (ctx) =>
      Promise.all(
        Array.from({ length: 11 }, () =>
          ctx.db.insert('chatroom_fileAttachments', {
            chatroomId: user.chatroomId,
            ownerUserId: user.userId,
            uploadedByRole: 'planner',
            filename: 'bulk.txt',
            mimeType: 'text/plain',
            sizeBytes: 1,
            status: 'pending_upload' as const,
            createdAt: Date.now(),
            expiresAt: Date.now() + PENDING_UPLOAD_TTL_MS,
          })
        )
      )
    );

    await expectConvexErrorCode(
      t.query(api.fileAttachments.getFileUrls, {
        sessionId: user.sessionId,
        attachmentIds: ids,
      }),
      'VALIDATION_ERROR'
    );

    await assertUsageInvariant(user.userId);
  });
});

describe('deleteFile (scenario 9)', () => {
  test('deletes the row, blob and usage, and the message reads the file as removed', async () => {
    const user = await setupUser('delete-file');
    const attachmentId = await uploadFile(user);
    const messageId = await bindFiles(user, [attachmentId]);
    const storageBefore = await countStorage();
    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(5);

    const result = await t.mutation(api.fileAttachments.deleteFile, {
      sessionId: user.sessionId,
      attachmentId,
    });

    expect(result).toEqual({ deleted: true });
    expect(await getRow(attachmentId)).toBeNull();
    expect(await countStorage()).toBe(storageBefore - 1);
    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(0);

    const feed = await t.query(api.messageList.getLatestMessages, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      limit: 20,
    });
    const enriched = feed.messages.find((message) => message._id === messageId);
    expect(enriched?.attachedFiles).toEqual([{ _id: attachmentId, status: 'removed' }]);

    await assertUsageInvariant(user.userId);
  });

  test('a second delete returns deleted:false', async () => {
    const user = await setupUser('delete-twice');
    const attachmentId = await uploadFile(user);
    await bindFiles(user, [attachmentId]);

    const first = await t.mutation(api.fileAttachments.deleteFile, {
      sessionId: user.sessionId,
      attachmentId,
    });
    const second = await t.mutation(api.fileAttachments.deleteFile, {
      sessionId: user.sessionId,
      attachmentId,
    });

    expect(first).toEqual({ deleted: true });
    expect(second).toEqual({ deleted: false });

    await assertUsageInvariant(user.userId);
  });

  test('rejects a CLI session', async () => {
    const user = await setupUser('delete-cli');
    const attachmentId = await uploadFile(user);
    const cliSessionId = await createCliSession(user);

    await expectConvexErrorCode(
      t.mutation(api.fileAttachments.deleteFile, {
        sessionId: cliSessionId,
        attachmentId,
      }),
      'WEB_SESSION_REQUIRED'
    );

    expect((await getRow(attachmentId))?.status).toBe('uploaded');
    await assertUsageInvariant(user.userId);
  });
});

describe('purgeFiles (scenario 10)', () => {
  test.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
  ])('rejects a %s minSizeBytes', async (label, minSizeBytes) => {
    const user = await setupUser(`purge-invalid-min-${label}`);
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 1,
      sizeBytes: 10,
    });

    await expectConvexErrorCode(
      t.mutation(api.fileAttachments.purgeFiles, {
        sessionId: user.sessionId,
        minSizeBytes,
      }),
      'VALIDATION_ERROR'
    );

    expect(await countAttachedRows(user.chatroomId)).toBe(1);
    await assertUsageInvariant(user.userId);
  });

  test('chatroom purge with minSizeBytes deletes only the large files', async () => {
    const user = await setupUser('purge-chatroom');
    const small = await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 2,
      sizeBytes: 10,
      filenamePrefix: 'small',
    });
    const large = await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 2,
      sizeBytes: MiB,
      filenamePrefix: 'large',
    });

    const result = await t.mutation(api.fileAttachments.purgeFiles, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      minSizeBytes: MiB,
    });

    expect(result).toEqual({ deleted: 2, continuing: false });
    for (const id of large) expect(await getRow(id)).toBeNull();
    for (const id of small) expect((await getRow(id))?.status).toBe('attached');

    await assertUsageInvariant(user.userId);
  });

  test('user purge covers every chatroom of the user', async () => {
    const user = await setupUser('purge-user');
    const secondChatroomId = await createDuoTeamChatroom(user.sessionId);
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 2,
      sizeBytes: 4,
      filenamePrefix: 'first-room',
    });
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: secondChatroomId,
      count: 2,
      sizeBytes: 4,
      filenamePrefix: 'second-room',
    });

    const result = await t.mutation(api.fileAttachments.purgeFiles, {
      sessionId: user.sessionId,
    });

    expect(result).toEqual({ deleted: 4, continuing: false });
    expect(await countAttachedRows(user.chatroomId)).toBe(0);
    expect(await countAttachedRows(secondChatroomId)).toBe(0);

    await assertUsageInvariant(user.userId);
  });

  test('purges 150 files through the continuation', async () => {
    vi.useFakeTimers();
    const user = await setupUser('purge-continuation');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 150,
      sizeBytes: 1,
    });

    const first = await t.mutation(api.fileAttachments.purgeFiles, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
    });
    expect(first).toEqual({ deleted: 100, continuing: true });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await countAttachedRows(user.chatroomId)).toBe(0);
    await assertUsageInvariant(user.userId);
  });

  test("chatroom purge leaves another owner's rows and usage untouched", async () => {
    const owner = await setupUser('purge-foreign-owner');
    const other = await setupUser('purge-foreign-other');
    const ownRows = await seedAttachedRows({
      userId: owner.userId,
      chatroomId: owner.chatroomId,
      count: 2,
      sizeBytes: 3,
      filenamePrefix: 'own',
    });
    const [foreignRow] = await seedAttachedRows({
      userId: other.userId,
      chatroomId: owner.chatroomId,
      count: 1,
      sizeBytes: 7,
      filenamePrefix: 'foreign',
    });
    const foreignUsageBefore = await getUsage(other.userId, owner.chatroomId);

    const result = await t.mutation(api.fileAttachments.purgeFiles, {
      sessionId: owner.sessionId,
      chatroomId: owner.chatroomId,
    });

    expect(result).toEqual({ deleted: 2, continuing: false });
    for (const id of ownRows) expect(await getRow(id)).toBeNull();
    expect((await getRow(foreignRow!))?.status).toBe('attached');
    expect(await getUsage(other.userId, owner.chatroomId)).toEqual(foreignUsageBefore);

    await assertUsageInvariant(owner.userId);
    await assertUsageInvariant(other.userId);
  });
});

describe('quota eviction (scenario 11)', () => {
  test('evicts the oldest attached file when the chatroom quota is lowered', async () => {
    vi.useFakeTimers();
    const base = 1_800_300_000_000;
    const user = await setupUser('evict-chatroom');

    const ids: Id<'chatroom_fileAttachments'>[] = [];
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(base + i * 1000);
      ids.push(await uploadFile(user, { sizeBytes: MiB, filename: `file-${i}.txt` }));
    }
    for (let i = 0; i < ids.length; i++) {
      vi.setSystemTime(base + 10_000 + i * 1000);
      await bindFiles(user, [ids[i]!], `Attach file ${i}`);
    }

    vi.setSystemTime(base + 20_000);
    const result = await t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      quotaBytes: 3 * MiB,
    });
    expect(result.evictionScheduled).toBe(true);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await getRow(ids[0]!)).toBeNull();
    for (const id of ids.slice(1)) {
      expect((await getRow(id))?.status).toBe('attached');
    }
    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(3 * MiB);

    await assertUsageInvariant(user.userId);
  });

  test('evicts the oldest attached file across chatrooms when the user quota is lowered', async () => {
    vi.useFakeTimers();
    const base = 1_800_500_000_000;
    const user = await setupUser('evict-user');
    const secondChatroomId = await createDuoTeamChatroom(user.sessionId);

    vi.setSystemTime(base);
    const older = await uploadFile(user, {
      sizeBytes: MiB,
      filename: 'older.txt',
      chatroomId: user.chatroomId,
    });
    vi.setSystemTime(base + 1000);
    const newer = await uploadFile(user, {
      sizeBytes: MiB,
      filename: 'newer.txt',
      chatroomId: secondChatroomId,
    });

    vi.setSystemTime(base + 2000);
    await bindFiles(user, [older], 'older', user.chatroomId);
    vi.setSystemTime(base + 3000);
    await bindFiles(user, [newer], 'newer', secondChatroomId);

    const result = await t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
      sessionId: user.sessionId,
      quotaBytes: MiB,
    });
    expect(result.evictionScheduled).toBe(true);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await getRow(older)).toBeNull();
    expect((await getRow(newer))?.status).toBe('attached');
    expect((await getUsage(user.userId, undefined))?.bytes).toBe(MiB);

    await assertUsageInvariant(user.userId);
  });

  test('never evicts in-flight uploaded rows and triggers eviction on bind', async () => {
    vi.useFakeTimers();
    const base = 1_800_700_000_000;
    vi.setSystemTime(base);
    const user = await setupUser('evict-uploaded');

    const inFlightA = await uploadFile(user, { sizeBytes: MiB, filename: 'a.txt' });
    const inFlightB = await uploadFile(user, { sizeBytes: MiB, filename: 'b.txt' });
    const toBind = await uploadFile(user, { sizeBytes: MiB, filename: 'c.txt' });

    // Lower the quota directly so no setter schedules eviction; only the
    // bind-time trigger can enforce it.
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_fileStorageSettings', {
        chatroomId: user.chatroomId,
        quotaBytes: MiB,
        updatedBy: user.userId,
        updatedAt: Date.now(),
      });
    });

    vi.setSystemTime(base + 1000);
    await bindFiles(user, [toBind], 'bind over quota');
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await getRow(toBind)).toBeNull();
    expect((await getRow(inFlightA))?.status).toBe('uploaded');
    expect((await getRow(inFlightB))?.status).toBe('uploaded');
    expect((await getUsage(user.userId, user.chatroomId))?.bytes).toBe(2 * MiB);

    await assertUsageInvariant(user.userId);
  });
});

describe('listFiles', () => {
  test('lists owner attached files largest-first and oldest-first', async () => {
    vi.useFakeTimers();
    const base = 1_800_900_000_000;
    vi.setSystemTime(base);
    const user = await setupUser('list-files');

    const small = await uploadFile(user, { sizeBytes: 1, filename: 'small.txt' });
    const large = await uploadFile(user, { sizeBytes: 3, filename: 'large.txt' });
    const medium = await uploadFile(user, { sizeBytes: 2, filename: 'medium.txt' });

    vi.setSystemTime(base + 1000);
    await bindFiles(user, [small], 'small');
    vi.setSystemTime(base + 2000);
    await bindFiles(user, [large], 'large');
    vi.setSystemTime(base + 3000);
    await bindFiles(user, [medium], 'medium');

    const largest = await t.query(api.fileAttachments.listFiles, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      sort: 'largest',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(largest.page.map((row) => row._id)).toEqual([large, medium, small]);
    expect(largest.page.map((row) => row.sizeBytes)).toEqual([3, 2, 1]);
    expect(largest.page[0]!.filename).toBe('large.txt');
    expect(largest.page[0]!.chatroomId).toBe(user.chatroomId);

    const oldest = await t.query(api.fileAttachments.listFiles, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      sort: 'oldest',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(oldest.page.map((row) => row._id)).toEqual([small, large, medium]);

    await assertUsageInvariant(user.userId);
  });

  test('caps a page at FILE_LIST_PAGE_MAX rows', async () => {
    const user = await setupUser('list-cap');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 30,
      sizeBytes: 1,
    });

    const page = await t.query(api.fileAttachments.listFiles, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      sort: 'largest',
      paginationOpts: { numItems: 100, cursor: null },
    });

    expect(page.page).toHaveLength(FILE_LIST_PAGE_MAX);
    expect(page.isDone).toBe(false);

    await assertUsageInvariant(user.userId);
  });

  test('chatroom scope skips rows owned by another user', async () => {
    const owner = await setupUser('list-foreign-owner');
    const other = await setupUser('list-foreign-other');
    const [ownRow] = await seedAttachedRows({
      userId: owner.userId,
      chatroomId: owner.chatroomId,
      count: 1,
      sizeBytes: 1,
      filenamePrefix: 'own',
    });
    const [foreignRow] = await seedAttachedRows({
      userId: other.userId,
      chatroomId: owner.chatroomId,
      count: 1,
      sizeBytes: 2,
      filenamePrefix: 'foreign',
    });

    const page = await t.query(api.fileAttachments.listFiles, {
      sessionId: owner.sessionId,
      chatroomId: owner.chatroomId,
      sort: 'oldest',
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(page.page.map((row) => row._id)).toEqual([ownRow]);
    expect(page.page.some((row) => row._id === foreignRow)).toBe(false);

    await assertUsageInvariant(owner.userId);
    await assertUsageInvariant(other.userId);
  });

  test('rejects CLI sessions and non-owners', async () => {
    const user = await setupUser('list-access');
    const cliSessionId = await createCliSession(user);

    await expectConvexErrorCode(
      t.query(api.fileAttachments.listFiles, {
        sessionId: cliSessionId,
        chatroomId: user.chatroomId,
        sort: 'oldest',
        paginationOpts: { numItems: 10, cursor: null },
      }),
      'WEB_SESSION_REQUIRED'
    );

    const other = await setupUser('list-access-other');
    await expectConvexErrorCode(
      t.query(api.fileAttachments.listFiles, {
        sessionId: other.sessionId,
        chatroomId: user.chatroomId,
        sort: 'oldest',
        paginationOpts: { numItems: 10, cursor: null },
      }),
      'ACCESS_DENIED'
    );

    await assertUsageInvariant(user.userId);
    await assertUsageInvariant(other.userId);
  });

  test('distinguishes an unnamed live chatroom from a deleted chatroom', async () => {
    const user = await setupUser('list-chatroom-label');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 1,
      sizeBytes: 1,
    });

    const live = await t.query(api.fileAttachments.listFiles, {
      sessionId: user.sessionId,
      sort: 'oldest',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(live.page[0]!.chatroomDeleted).toBe(false);
    expect(live.page[0]!.chatroomName).toBeUndefined();

    await t.run(async (ctx) => ctx.db.delete('chatroom_rooms', user.chatroomId));

    const deleted = await t.query(api.fileAttachments.listFiles, {
      sessionId: user.sessionId,
      sort: 'oldest',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(deleted.page[0]!.chatroomDeleted).toBe(true);
    expect(deleted.page[0]!.chatroomName).toBeUndefined();

    await assertUsageInvariant(user.userId);
  });
});
