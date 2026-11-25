/**
 * Chatroom export driver — paging, consistency, size and identity.
 *
 * These specs run `runExport` through the convex-test port, so paging, byte
 * budgets, auth and serialization are the real implementation. Only the port is
 * substituted, and only to count reads or to make a write land between two
 * reads (the exact failure the consistency stamp exists for).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode, exportPortFor, wrapPortMutatingBetweenPages } from './convex-test-ports';
import { runExport, type ChatroomExportPort, type RunExportArgs } from './export-driver';
import { api } from '../../../../convex/_generated/api';
import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import schema from '../../../../convex/schema';
import { t } from '../../../../test.setup';
import { EXPORT_PAGE_MAX_BYTES } from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;

interface ChatroomFixture {
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  port: ChatroomExportPort;
}

async function createChatroom(): Promise<ChatroomFixture> {
  sessionCounter += 1;
  const sessionId = `export-driver-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, { sessionId });
  return {
    sessionId,
    chatroomId,
    userId: login.userId as Id<'users'>,
    port: exportPortFor(t, sessionId),
  };
}

async function insertMessages(
  chatroomId: Id<'chatroom_rooms'>,
  contents: readonly string[]
): Promise<Id<'chatroom_messages'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'chatroom_messages'>[] = [];
    for (const content of contents) {
      ids.push(
        await ctx.db.insert('chatroom_messages', {
          chatroomId,
          senderRole: 'user',
          content,
          type: 'message',
        })
      );
    }
    return ids;
  });
}

async function insertTasks(
  chatroomId: Id<'chatroom_rooms'>,
  contents: readonly string[]
): Promise<Id<'chatroom_tasks'>[]> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<'chatroom_tasks'>[] = [];
    for (const content of contents) {
      ids.push(
        await ctx.db.insert('chatroom_tasks', {
          chatroomId,
          createdBy: 'user',
          content,
          status: 'pending',
          queuePosition: 0,
          createdAt: now,
          updatedAt: now,
        })
      );
    }
    return ids;
  });
}

function exportArgs(chatroomId: string, overrides: Partial<RunExportArgs> = {}): RunExportArgs {
  return {
    chatroomId,
    cliVersion: '1.2.3',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected runExport to fail');
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

describe('paging', () => {
  test('exports 450 messages in insertion order across pages', async () => {
    const { chatroomId, port } = await createChatroom();
    const contents = Array.from({ length: 450 }, (_, index) => `message ${index}`);
    await insertMessages(chatroomId, contents);

    const { file } = await runExport(port, exportArgs(chatroomId));

    expect(file.messages).toHaveLength(450);
    expect(file.messages.map((row) => row.content)).toEqual(contents);
    expect(file.messages[0]._key).toBe('m0');
    expect(file.messages[449]._key).toBe('m449');
  });

  test('exports messages larger than a quarter of the page byte budget', async () => {
    const { chatroomId, port } = await createChatroom();
    const oversized = 'x'.repeat(EXPORT_PAGE_MAX_BYTES / 4 + 1);
    const contents = Array.from({ length: 6 }, () => oversized);
    await insertMessages(chatroomId, contents);

    const { file } = await runExport(port, exportArgs(chatroomId));

    expect(file.messages).toHaveLength(6);
    expect(file.messages.map((row) => row.content)).toEqual(contents);

    const stored = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query('chatroom_messages')
            .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
            .collect()
        ).length
    );
    expect(file.messages.length).toBe(stored);
  });
});

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

describe('consistency', () => {
  test('fails with EXPORT_CHATROOM_CHANGED when a message is appended between pages', async () => {
    const { chatroomId, port } = await createChatroom();
    await insertMessages(
      chatroomId,
      Array.from({ length: 450 }, (_, index) => `message ${index}`)
    );

    let appended = false;
    const wrapped = wrapPortMutatingBetweenPages(port, async (category) => {
      if (category !== 'messages' || appended) return;
      appended = true;
      await insertMessages(chatroomId, ['appended between pages']);
    });

    let result: unknown;
    const error = await runExport(wrapped, exportArgs(chatroomId)).then(
      (value) => {
        result = value;
        return undefined;
      },
      (reason: unknown) => reason
    );

    expect(result).toBeUndefined();
    expect(errorCode(error)).toBe('EXPORT_CHATROOM_CHANGED');
  });

  test('fails with EXPORT_CHATROOM_CHANGED when a task changes between reads', async () => {
    const { chatroomId, port } = await createChatroom();
    const [taskId] = await insertTasks(chatroomId, ['first task']);

    let taskReads = 0;
    const wrapped = wrapPortMutatingBetweenPages(port, async (category) => {
      if (category !== 'tasks') return;
      taskReads += 1;
      // The driver reads tasks once and re-reads them for the consistency
      // check; patching before the re-read is the change-between-pages case.
      if (taskReads !== 2) return;
      await t.run(async (ctx) => ctx.db.patch(taskId, { status: 'completed' }));
    });

    const error = await failure(runExport(wrapped, exportArgs(chatroomId)));
    expect(errorCode(error)).toBe('EXPORT_CHATROOM_CHANGED');
  });
});

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

describe('size limits', () => {
  test('fails with EXPORT_TOO_LARGE past a configured limit', async () => {
    const { chatroomId, port } = await createChatroom();
    await insertMessages(chatroomId, ['a'.repeat(1_000), 'b'.repeat(1_000), 'c'.repeat(1_000)]);

    const error = await failure(
      runExport(port, exportArgs(chatroomId, { limits: { maxFileBytes: 2_000 } }))
    );
    expect(errorCode(error)).toBe('EXPORT_TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('identity', () => {
  test('two exports of an unchanged chatroom differ only in exportedAt', async () => {
    const { chatroomId, port } = await createChatroom();
    await insertMessages(chatroomId, ['one', 'two']);

    const first = await runExport(
      port,
      exportArgs(chatroomId, { now: () => new Date('2026-01-01T00:00:00.000Z') })
    );
    const second = await runExport(
      port,
      exportArgs(chatroomId, { now: () => new Date('2026-03-03T00:00:00.000Z') })
    );

    expect(second.file.exportedAt).not.toBe(first.file.exportedAt);
    expect(withoutExportedAt(second.json)).toEqual(withoutExportedAt(first.json));
  });
});

function withoutExportedAt(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  delete parsed.exportedAt;
  return parsed;
}

// ---------------------------------------------------------------------------
// Refusal and zero writes
// ---------------------------------------------------------------------------

describe('attachments', () => {
  test('refuses before reading any page', async () => {
    const { chatroomId, port, userId } = await createChatroom();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_fileAttachments', {
        chatroomId,
        ownerUserId: userId,
        uploadedByRole: 'builder',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        status: 'attached',
        createdAt: Date.now(),
      });
    });

    let pageReads = 0;
    const counting: ChatroomExportPort = {
      getStamp: (id) => port.getStamp(id),
      readPage: async (args) => {
        pageReads += 1;
        return port.readPage(args);
      },
    };

    const error = await failure(runExport(counting, exportArgs(chatroomId)));
    expect(errorCode(error)).toBe('EXPORT_ATTACHMENTS_PRESENT');
    expect(pageReads).toBe(0);
  });
});

describe('read-only', () => {
  test('never writes a chatroom table', async () => {
    const { chatroomId, port } = await createChatroom();
    await insertMessages(chatroomId, ['one', 'two']);
    await insertTasks(chatroomId, ['a task']);

    const tables = (Object.keys(schema.tables) as TableNames[]).filter((name) =>
      name.startsWith('chatroom_')
    );
    const before = await rowCounts(tables);
    await runExport(port, exportArgs(chatroomId));
    const after = await rowCounts(tables);

    expect(after).toEqual(before);
  });
});

async function rowCounts(tables: readonly TableNames[]): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] = (await ctx.db.query(table).collect()).length;
    }
    return counts;
  });
}
