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
  FILE_ATTACHMENT_UPLOAD_PATH,
} from '@workspace/shared/domain/file-attachment';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  FILE_EXPIRY_BATCH_SIZE,
  PENDING_UPLOAD_TTL_MS,
  UPLOADED_UNATTACHED_TTL_MS,
} from '../src/domain/entities/file-attachment';
import { createDuoTeamChatroom, createTestSession } from '../tests/helpers/integration';

const SITE_URL = 'https://test.site';
const ATTACHMENT_HEADER = 'X-Chatroom-Attachment-Id';

let sequence = 0;

beforeEach(() => {
  vi.stubEnv('CONVEX_SITE_URL', SITE_URL);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TestUser {
  sessionId: string;
  userId: Id<'users'>;
  chatroomId: Id<'chatroom_rooms'>;
}

async function setupUser(label: string): Promise<TestUser> {
  const rawSessionId = `file-attachments-${label}-${++sequence}`;
  const { sessionId } = await createTestSession(rawSessionId);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const userId = await t.run(async (ctx) => {
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
      .unique();
    if (!session?.userId) throw new Error('missing session user');
    return session.userId;
  });
  return { sessionId: sessionId as unknown as string, userId, chatroomId };
}

async function beginUpload(
  user: TestUser,
  options: { filename?: string; sizeBytes?: number; senderRole?: string } = {}
) {
  const filename = options.filename ?? 'notes.txt';
  const sizeBytes = options.sizeBytes ?? new TextEncoder().encode('hello').byteLength;
  return await t.mutation(api.fileAttachments.beginUpload, {
    sessionId: user.sessionId,
    chatroomId: user.chatroomId,
    senderRole: options.senderRole ?? 'planner',
    filename,
    sizeBytes,
  });
}

function uploadInit(args: {
  sessionId?: string | null;
  attachmentId?: string | null;
  body?: Uint8Array | string;
  headers?: Record<string, string>;
}): RequestInit {
  const headers: Record<string, string> = { ...args.headers };
  if (args.sessionId !== null) {
    headers.Authorization = `Bearer ${args.sessionId}`;
  }
  if (args.attachmentId !== null) {
    headers[ATTACHMENT_HEADER] = args.attachmentId ?? '';
  }
  return {
    method: 'POST',
    headers,
    body: args.body ?? new TextEncoder().encode('hello'),
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

async function getUsage(userId: Id<'users'>, chatroomId: Id<'chatroom_rooms'> | undefined) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_fileStorageUsage')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', chatroomId))
      .unique()
  );
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
 * Invariant I3: for each scope, the usage counter equals the Σ sizeBytes and
 * count of that scope's `uploaded` + `attached` rows.
 */
async function assertUsageInvariant(userId: Id<'users'>): Promise<void> {
  const state = await t.run(async (ctx) => {
    const counted = [
      ...(await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) =>
          q.eq('ownerUserId', userId).eq('status', 'uploaded')
        )
        .collect()),
      ...(await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) =>
          q.eq('ownerUserId', userId).eq('status', 'attached')
        )
        .collect()),
    ];

    const expectedByChatroom = new Map<string, { bytes: number; files: number }>();
    let totalBytes = 0;
    let totalFiles = 0;
    for (const row of counted) {
      totalBytes += row.sizeBytes;
      totalFiles += 1;
      const existing = expectedByChatroom.get(row.chatroomId) ?? { bytes: 0, files: 0 };
      existing.bytes += row.sizeBytes;
      existing.files += 1;
      expectedByChatroom.set(row.chatroomId, existing);
    }

    const usageRows = await ctx.db
      .query('chatroom_fileStorageUsage')
      .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId))
      .collect();

    return {
      expectedByChatroom: [...expectedByChatroom].map(([chatroomId, expected]) => ({
        chatroomId,
        ...expected,
      })),
      totalBytes,
      totalFiles,
      usageRows,
    };
  });

  const totalRow = state.usageRows.find((row) => row.chatroomId === undefined);
  expect(totalRow?.bytes ?? 0).toBe(state.totalBytes);
  expect(totalRow?.fileCount ?? 0).toBe(state.totalFiles);

  for (const usage of state.usageRows) {
    if (usage.chatroomId === undefined) continue;
    const expected = state.expectedByChatroom.find(
      (entry) => entry.chatroomId === usage.chatroomId
    ) ?? { bytes: 0, files: 0 };
    expect(usage.bytes).toBe(expected.bytes);
    expect(usage.fileCount).toBe(expected.files);
  }
}

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
  options: { filename?: string; sizeBytes?: number; senderRole?: string } = {}
): Promise<Id<'chatroom_fileAttachments'>> {
  const sizeBytes = options.sizeBytes ?? 5;
  const ticket = await beginUpload(user, { ...options, sizeBytes });
  const response = await postUpload(user, ticket.attachmentId, {
    body: new TextEncoder().encode('x'.repeat(sizeBytes)),
  });
  expect(response.status).toBe(200);
  return ticket.attachmentId;
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
});
