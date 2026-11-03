/**
 * File storage settings tests (S5).
 *
 * Covers quota defaults, validation, web-session and ownership access, the
 * effective-quota math, and eviction scheduled by lowering a quota below usage.
 * Every scenario ends with invariant I3 through the shared helper.
 */

import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import {
  DEFAULT_CHATROOM_FILE_QUOTA_BYTES,
  DEFAULT_USER_FILE_QUOTA_BYTES,
  PLATFORM_MAX_FILE_QUOTA_BYTES,
} from '../src/domain/entities/file-attachment';
import {
  assertUsageInvariant,
  createCliSession,
  getFileUsageRow,
  seedAttachedRows,
  setupFileUser,
} from '../tests/helpers/fileAttachmentUsage';

const MiB = 1024 * 1024;

afterEach(() => {
  vi.useRealTimers();
});

async function expectConvexErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError).data).toMatchObject({ code });
}

describe('file storage settings defaults', () => {
  test('returns the platform defaults without inserting settings rows', async () => {
    const user = await setupFileUser('settings-defaults');

    const userStorage = await t.query(api.fileStorageSettings.getUserFileStorage, {
      sessionId: user.sessionId,
    });
    expect(userStorage).toEqual({
      quotaBytes: DEFAULT_USER_FILE_QUOTA_BYTES,
      isDefault: true,
      platformMaxQuotaBytes: PLATFORM_MAX_FILE_QUOTA_BYTES,
      usage: { bytes: 0, fileCount: 0 },
    });

    const chatroomStorage = await t.query(api.fileStorageSettings.getChatroomFileStorage, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
    });
    expect(chatroomStorage).toEqual({
      quotaBytes: DEFAULT_CHATROOM_FILE_QUOTA_BYTES,
      isDefault: true,
      userQuotaBytes: DEFAULT_USER_FILE_QUOTA_BYTES,
      effectiveQuotaBytes: DEFAULT_CHATROOM_FILE_QUOTA_BYTES,
      platformMaxQuotaBytes: PLATFORM_MAX_FILE_QUOTA_BYTES,
      usage: { bytes: 0, fileCount: 0 },
    });

    const rows = await t.run(async (ctx) => ({
      user: await ctx.db.query('chatroom_userFileStorageSettings').collect(),
      chatroom: await ctx.db.query('chatroom_fileStorageSettings').collect(),
    }));
    expect(rows).toEqual({ user: [], chatroom: [] });

    await assertUsageInvariant(user.userId);
  });
});

describe('file storage settings validation', () => {
  test('rejects non-integer, negative, and above-ceiling quotas', async () => {
    const user = await setupFileUser('settings-validation');

    for (const quotaBytes of [-1, 1.5, PLATFORM_MAX_FILE_QUOTA_BYTES + 1]) {
      await expectConvexErrorCode(
        t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
          sessionId: user.sessionId,
          quotaBytes,
        }),
        'VALIDATION_ERROR'
      );
      await expectConvexErrorCode(
        t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
          sessionId: user.sessionId,
          chatroomId: user.chatroomId,
          quotaBytes,
        }),
        'VALIDATION_ERROR'
      );
    }

    await assertUsageInvariant(user.userId);
  });

  test('accepts zero to disable uploads', async () => {
    const user = await setupFileUser('settings-zero');

    const result = await t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      quotaBytes: 0,
    });

    expect(result.quotaBytes).toBe(0);
    expect(result.evictionScheduled).toBe(false);

    await assertUsageInvariant(user.userId);
  });
});

describe('file storage settings access', () => {
  test('rejects CLI sessions on every function', async () => {
    const user = await setupFileUser('settings-cli');
    const cliSessionId = await createCliSession(user);

    await expectConvexErrorCode(
      t.query(api.fileStorageSettings.getUserFileStorage, { sessionId: cliSessionId }),
      'WEB_SESSION_REQUIRED'
    );
    await expectConvexErrorCode(
      t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
        sessionId: cliSessionId,
        quotaBytes: MiB,
      }),
      'WEB_SESSION_REQUIRED'
    );
    await expectConvexErrorCode(
      t.query(api.fileStorageSettings.getChatroomFileStorage, {
        sessionId: cliSessionId,
        chatroomId: user.chatroomId,
      }),
      'WEB_SESSION_REQUIRED'
    );
    await expectConvexErrorCode(
      t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
        sessionId: cliSessionId,
        chatroomId: user.chatroomId,
        quotaBytes: MiB,
      }),
      'WEB_SESSION_REQUIRED'
    );

    await assertUsageInvariant(user.userId);
  });

  test('rejects a non-owner chatroom with ACCESS_DENIED', async () => {
    const owner = await setupFileUser('settings-owner');
    const other = await setupFileUser('settings-non-owner');

    await expectConvexErrorCode(
      t.query(api.fileStorageSettings.getChatroomFileStorage, {
        sessionId: other.sessionId,
        chatroomId: owner.chatroomId,
      }),
      'ACCESS_DENIED'
    );
    await expectConvexErrorCode(
      t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
        sessionId: other.sessionId,
        chatroomId: owner.chatroomId,
        quotaBytes: MiB,
      }),
      'ACCESS_DENIED'
    );

    await assertUsageInvariant(owner.userId);
    await assertUsageInvariant(other.userId);
  });
});

describe('effective chatroom quota', () => {
  test('is the minimum of the chatroom and user quotas', async () => {
    const user = await setupFileUser('settings-effective');

    await t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
      sessionId: user.sessionId,
      quotaBytes: 2 * MiB,
    });
    await t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      quotaBytes: 3 * MiB,
    });

    const userBound = await t.query(api.fileStorageSettings.getChatroomFileStorage, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
    });
    expect(userBound.userQuotaBytes).toBe(2 * MiB);
    expect(userBound.quotaBytes).toBe(3 * MiB);
    expect(userBound.effectiveQuotaBytes).toBe(2 * MiB);
    expect(userBound.isDefault).toBe(false);

    await t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      quotaBytes: MiB,
    });

    const chatroomBound = await t.query(api.fileStorageSettings.getChatroomFileStorage, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
    });
    expect(chatroomBound.effectiveQuotaBytes).toBe(MiB);

    const userStorage = await t.query(api.fileStorageSettings.getUserFileStorage, {
      sessionId: user.sessionId,
    });
    expect(userStorage.quotaBytes).toBe(2 * MiB);
    expect(userStorage.isDefault).toBe(false);

    await assertUsageInvariant(user.userId);
  });
});

describe('lowering a quota below usage', () => {
  test('schedules eviction and ends at or below the user quota', async () => {
    vi.useFakeTimers();
    const user = await setupFileUser('settings-evict-user');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 3,
      sizeBytes: MiB,
      filenamePrefix: 'user-evict',
    });

    const result = await t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
      sessionId: user.sessionId,
      quotaBytes: 2 * MiB,
    });
    expect(result).toEqual({ quotaBytes: 2 * MiB, evictionScheduled: true });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const usage = await getFileUsageRow(user.userId, undefined);
    expect(usage?.bytes).toBe(2 * MiB);
    expect(usage!.bytes).toBeLessThanOrEqual(2 * MiB);

    await assertUsageInvariant(user.userId);
  });

  test('schedules eviction and ends at or below the chatroom quota', async () => {
    vi.useFakeTimers();
    const user = await setupFileUser('settings-evict-chatroom');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 3,
      sizeBytes: MiB,
      filenamePrefix: 'chatroom-evict',
    });

    const result = await t.mutation(api.fileStorageSettings.setChatroomFileStorageQuota, {
      sessionId: user.sessionId,
      chatroomId: user.chatroomId,
      quotaBytes: 2 * MiB,
    });
    expect(result).toEqual({ quotaBytes: 2 * MiB, evictionScheduled: true });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const usage = await getFileUsageRow(user.userId, user.chatroomId);
    expect(usage?.bytes).toBe(2 * MiB);
    expect(usage!.bytes).toBeLessThanOrEqual(2 * MiB);

    await assertUsageInvariant(user.userId);
  });

  test('does not schedule eviction when usage already fits', async () => {
    const user = await setupFileUser('settings-fit');
    await seedAttachedRows({
      userId: user.userId,
      chatroomId: user.chatroomId,
      count: 1,
      sizeBytes: MiB,
      filenamePrefix: 'fit',
    });

    const result = await t.mutation(api.fileStorageSettings.setUserFileStorageQuota, {
      sessionId: user.sessionId,
      quotaBytes: 2 * MiB,
    });
    expect(result.evictionScheduled).toBe(false);

    await assertUsageInvariant(user.userId);
  });
});
