/**
 * Chatroom export read — stall guard and attachment stamp.
 *
 * A page that reports more work but returns no rows would make the driver loop
 * forever. `assertNotStalled` is pure, so this failure is provable without a
 * database; the paged path itself is covered through `chatroomExport.spec.ts`
 * and the driver spec. The attachment stamp is read through convex-test because
 * it sums real rows.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { assertNotStalled, readExportStamp, type ExportStamp } from './export-read';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { canonicalJson } from '../../entities/chatroom-transfer-file';

function stallCode(error: unknown): string | undefined {
  if (!(error instanceof ConvexError)) return undefined;
  return (error.data as { code?: string }).code;
}

describe('assertNotStalled', () => {
  test('throws EXPORT_PAGE_STALLED when an unfinished page has no rows', () => {
    try {
      assertNotStalled({ rows: [], isDone: false }, 'messages');
      expect.unreachable('assertNotStalled should have thrown');
    } catch (error) {
      expect(stallCode(error)).toBe('EXPORT_PAGE_STALLED');
    }
  });

  test('accepts an empty final page', () => {
    expect(() => assertNotStalled({ rows: [], isDone: true }, 'messages')).not.toThrow();
  });

  test('accepts a non-empty unfinished page', () => {
    expect(() => assertNotStalled({ rows: [{}], isDone: false }, 'tasks')).not.toThrow();
  });
});

/** A stamp whose only varying field is the attachment projection. */
function stamp(totalBytes: number): ExportStamp {
  return {
    lastActivityAt: null,
    nextQueuePosition: null,
    latestMessage: null,
    taskCounts: null,
    latest: {},
    attachmentRows: { count: 1, capped: false, totalBytes },
  };
}

describe('attachment stamp', () => {
  test('sums sizeBytes over the bounded attachment rows', async () => {
    const sessionId = 'export-read-attachments' as SessionId;
    const login = await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, { sessionId });
    await t.run(async (ctx) => {
      for (const sizeBytes of [5, 7, 11]) {
        await ctx.db.insert('chatroom_fileAttachments', {
          chatroomId,
          ownerUserId: login.userId as Id<'users'>,
          uploadedByRole: 'builder',
          filename: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes,
          status: 'attached',
          createdAt: Date.now(),
        });
      }
    });

    const read = await t.run(async (ctx) => readExportStamp(ctx, chatroomId));

    expect(read.attachmentRows).toEqual({ count: 3, capped: false, totalBytes: 23 });
  });

  test('stamps differing only in attachment bytes are unequal', () => {
    expect(canonicalJson(stamp(5))).not.toBe(canonicalJson(stamp(6)));
  });
});
