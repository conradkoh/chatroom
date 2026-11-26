import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { readTimelineMessagesForTest } from '../tests/helpers/timeline';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function insertTimelineMessage(
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string,
  content: string,
  extra?: {
    type?: 'message' | 'handoff' | 'join' | 'progress' | undefined;
    targetRole?: string | undefined;
  }
): Promise<Id<'chatroom_messages'>> {
  return await t.run(async (ctx) => {
    return (await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole,
      content,
      type: extra?.type ?? 'message',
      ...(extra?.targetRole ? { targetRole: extra.targetRole } : {}),
    })) as Id<'chatroom_messages'>;
  });
}

/** Seed an active task so `messages.notifyUser` accepts the sender role. */
async function seedActiveTask(
  chatroomId: Id<'chatroom_rooms'>,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return (await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Active work',
      status: 'in_progress',
      assignedTo,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    })) as Id<'chatroom_tasks'>;
  });
}

/** Send a real notice through `messages.notifyUser` and return its id. */
async function sendNotice(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<Id<'chatroom_messages'>> {
  const { messageId } = await t.mutation(api.messages.notifyUser, {
    sessionId,
    chatroomId,
    senderRole: 'builder',
    content,
  });
  return messageId;
}

async function getMessageCreationTime(id: Id<'chatroom_messages'>): Promise<number> {
  return await t.run(async (ctx) => {
    const row = await ctx.db.get('chatroom_messages', id);
    return row!._creationTime;
  });
}

async function expectConvexErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError).data).toMatchObject({ code });
}

describe('listPages', () => {
  test('returns an empty window when no messages exist', async () => {
    const { sessionId } = await createTestSession('conversation-nav-empty');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
    });

    expect(result).toEqual({
      pages: [],
      selectedPageId: null,
      prevPageId: null,
      nextPageId: null,
    });
  });

  test('defaults to the latest page and resolves prev/next for three user messages', async () => {
    const { sessionId } = await createTestSession('conversation-nav-3');
    const chatroomId = await createChatroom(sessionId);

    await insertTimelineMessage(chatroomId, 'user', 'oldest msg');
    const m2 = await insertTimelineMessage(chatroomId, 'user', 'middle msg');
    const m3 = await insertTimelineMessage(chatroomId, 'user', 'newest msg');

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
    });

    expect(result.selectedPageId).toBe(m3);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.pageId).toBe(m3);
    expect(result.pages[0]!.contentPreview).toBe('newest msg');
    expect(result.pages[0]!.endExclusive).toBeNull();
    expect(result.prevPageId).toBe(m2);
    expect(result.nextPageId).toBeNull();
  });

  test('respects an explicit pageId and resolves adjacent pages', async () => {
    const { sessionId } = await createTestSession('conversation-nav-explicit');
    const chatroomId = await createChatroom(sessionId);

    const m1 = await insertTimelineMessage(chatroomId, 'user', 'first');
    await insertTimelineMessage(chatroomId, 'builder', 'agent reply');
    const m3 = await insertTimelineMessage(chatroomId, 'user', 'second');
    const m4 = await insertTimelineMessage(chatroomId, 'user', 'third');

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: m3,
    });

    expect(result.selectedPageId).toBe(m3);
    expect(result.pages[0]!.pageId).toBe(m3);
    expect(result.pages[0]!.contentPreview).toBe('second');
    expect(result.prevPageId).toBe(m1);
    expect(result.nextPageId).toBe(m4);
    expect(result.pages[0]!.endExclusive).not.toBeNull();
  });

  test('throws when pageId is not a user message', async () => {
    const { sessionId } = await createTestSession('conversation-nav-notuser');
    const chatroomId = await createChatroom(sessionId);
    const builderMsg = await insertTimelineMessage(chatroomId, 'builder', 'builder msg');

    await expect(
      t.query(api.conversation.listPages, {
        sessionId,
        chatroomId,
        pageId: builderMsg,
      })
    ).rejects.toThrow();
  });

  test('latest page ignores non-start rows and reports the open end', async () => {
    const { sessionId } = await createTestSession('conversation-nav-latest');
    const chatroomId = await createChatroom(sessionId);

    await insertTimelineMessage(chatroomId, 'user', 'u1');
    await insertTimelineMessage(chatroomId, 'builder', 'h1', { type: 'handoff' });
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'u2');
    await insertTimelineMessage(chatroomId, 'builder', 'h2', { type: 'handoff' });
    const u3 = await insertTimelineMessage(chatroomId, 'user', 'u3');
    await insertTimelineMessage(chatroomId, 'builder', 'h3', { type: 'handoff' });

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
    });

    expect(result.pages.map((p) => p.pageId)).toEqual([u3]);
    expect(result.pages[0]!.endExclusive).toBeNull();
    expect(result.prevPageId).toBe(u2);
    expect(result.nextPageId).toBeNull();
  });

  test('returns a contiguous window with boundaries equal to the next start', async () => {
    const { sessionId } = await createTestSession('conversation-nav-window');
    const chatroomId = await createChatroom(sessionId);

    const u1 = await insertTimelineMessage(chatroomId, 'user', 'u1');
    await insertTimelineMessage(chatroomId, 'builder', 'h1', { type: 'handoff' });
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'u2');
    await insertTimelineMessage(chatroomId, 'builder', 'h2', { type: 'handoff' });
    const u3 = await insertTimelineMessage(chatroomId, 'user', 'u3');
    await insertTimelineMessage(chatroomId, 'builder', 'h3', { type: 'handoff' });

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u2,
      before: 2,
      after: 1,
    });

    expect(result.pages.map((p) => p.pageId)).toEqual([u1, u2, u3]);
    expect(result.pages[0]!.endExclusive).toBe(result.pages[1]!.startedAt);
    expect(result.pages[1]!.endExclusive).toBe(result.pages[2]!.startedAt);
    expect(result.pages[2]!.endExclusive).toBeNull();
    expect(result.prevPageId).toBeNull();
    expect(result.nextPageId).toBeNull();

    const selectedOnly = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u2,
      before: 0,
      after: 0,
    });

    expect(selectedOnly.pages).toHaveLength(1);
    expect(selectedOnly.pages[0]!.pageId).toBe(u2);
    expect(selectedOnly.pages[0]!.endExclusive).toBe(await getMessageCreationTime(u3));
    expect(selectedOnly.prevPageId).toBe(u1);
    expect(selectedOnly.nextPageId).toBe(u3);
  });

  test('a deleted explicit page falls back to the latest page', async () => {
    const { sessionId } = await createTestSession('conversation-nav-deleted-window');
    const chatroomId = await createChatroom(sessionId);
    const u1 = await insertTimelineMessage(chatroomId, 'user', 'u1');
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'u2');
    const u3 = await insertTimelineMessage(chatroomId, 'user', 'u3');

    await t.run((ctx) => ctx.db.delete('chatroom_messages', u2));

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u2,
    });

    expect(result.selectedPageId).toBe(u3);
    expect(result.pages.map((p) => p.pageId)).toEqual([u3]);
    expect(result.pages[0]!.contentPreview).toBe('u3');
    expect(result.prevPageId).toBe(u1);
  });

  test('rejects invalid page ids with the documented error codes', async () => {
    const { sessionId } = await createTestSession('conversation-nav-errors');
    const chatroomId = await createChatroom(sessionId);
    const otherChatroomId = await createChatroom(sessionId);

    const handoff = await insertTimelineMessage(chatroomId, 'builder', 'handoff', {
      type: 'handoff',
    });
    const wrongCase = await insertTimelineMessage(chatroomId, 'User', 'wrong case');
    const foreign = await insertTimelineMessage(otherChatroomId, 'user', 'foreign');

    await expectConvexErrorCode(
      t.query(api.conversation.listPages, { sessionId, chatroomId, pageId: handoff }),
      'INVALID_PAGE'
    );
    await expectConvexErrorCode(
      t.query(api.conversation.listPages, { sessionId, chatroomId, pageId: wrongCase }),
      'INVALID_PAGE'
    );
    await expectConvexErrorCode(
      t.query(api.conversation.listPages, { sessionId, chatroomId, pageId: foreign }),
      'INVALID_MESSAGE'
    );
  });

  test('clamps an oversized before span to the available pages', async () => {
    const { sessionId } = await createTestSession('conversation-nav-clamp');
    const chatroomId = await createChatroom(sessionId);

    const u1 = await insertTimelineMessage(chatroomId, 'user', 'u1');
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'u2');
    const u3 = await insertTimelineMessage(chatroomId, 'user', 'u3');

    const result = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u3,
      before: 999,
    });

    expect(result.pages.map((p) => p.pageId)).toEqual([u1, u2, u3]);
    expect(result.nextPageId).toBeNull();
  });
});

describe('listPageMessages', () => {
  test('returns an empty completed page when the requested page was deleted', async () => {
    const { sessionId } = await createTestSession('conversation-slice-deleted-anchor');
    const chatroomId = await createChatroom(sessionId);
    const deletedPage = await insertTimelineMessage(chatroomId, 'user', 'deleted page');

    await t.run((ctx) => ctx.db.delete('chatroom_messages', deletedPage));

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId: deletedPage,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe('');
  });

  test('defaults endExclusive to the open latest page when the field is omitted', async () => {
    const { sessionId } = await createTestSession('conversation-slice-omit-bound');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply');
    await insertTimelineMessage(chatroomId, 'user', 'next user');

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply');
    expect(contents).toContain('next user');
  });

  test('returns the page start plus replies and excludes the next page start', async () => {
    const { sessionId } = await createTestSession('conversation-slice-basic');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    await insertTimelineMessage(chatroomId, 'planner', 'reply2');
    await insertTimelineMessage(chatroomId, 'user', 'next user');
    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId,
    });

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });

    expect(pageNav.pages[0]!.endExclusive).not.toBeNull();
    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply1');
    expect(contents).toContain('reply2');
    expect(contents).not.toContain('next user');
  });

  test('a user message ends the previous page', async () => {
    const { sessionId } = await createTestSession('conversation-slice-followup');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'work');
    await insertTimelineMessage(chatroomId, 'user', 'follow up');
    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId,
    });

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('work');
    expect(contents).not.toContain('follow up');
  });

  test('the next page start provides the endExclusive bound', async () => {
    const { sessionId } = await createTestSession('conversation-slice-bound-fu');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'work');
    const followUpId = await insertTimelineMessage(chatroomId, 'user', 'follow up');

    const followUpTime = await getMessageCreationTime(followUpId);

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: followUpTime,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('work');
    expect(contents).not.toContain('follow up');
  });

  test('honours an explicit endExclusive bound', async () => {
    const { sessionId } = await createTestSession('conversation-slice-explicit');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    const nextUser = await insertTimelineMessage(chatroomId, 'user', 'next user');
    await insertTimelineMessage(chatroomId, 'builder', 'after page');

    const bound = await getMessageCreationTime(nextUser);

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: bound,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply1');
    expect(contents).not.toContain('next user');
    expect(contents).not.toContain('after page');
  });

  test('excludes messages after the page end', async () => {
    const { sessionId } = await createTestSession('conversation-slice-postbound');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'in-slice reply');
    await insertTimelineMessage(chatroomId, 'user', 'next user msg');
    for (let i = 0; i < 20; i++) {
      await insertTimelineMessage(chatroomId, 'builder', `post-page ${i}`);
    }
    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId,
    });

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('in-slice reply');
    expect(contents).not.toContain('next user msg');
    expect(contents).not.toContain('post-page');
  });

  test('excludes join and progress rows from the timeline', async () => {
    const { sessionId } = await createTestSession('conversation-slice-exclude');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply', { type: 'message' });
    await insertTimelineMessage(chatroomId, 'builder', 'join event', { type: 'join' });
    await insertTimelineMessage(chatroomId, 'builder', 'progress update', { type: 'progress' });

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: null,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply');
    expect(contents).not.toContain('join event');
    expect(contents).not.toContain('progress update');
  });

  test('paginates with a stable cursor when endExclusive is null', async () => {
    const { sessionId } = await createTestSession('conversation-slice-null-cursor');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    for (let i = 0; i < 35; i++) {
      await insertTimelineMessage(
        chatroomId,
        'builder',
        `reply ${i}`,
        i % 3 === 0 ? { type: 'join' } : undefined
      );
    }

    const firstPage = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: null,
    });
    const secondPage = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
      endExclusive: null,
    });

    expect(firstPage.isDone).toBe(false);
    const combined = [...firstPage.page, ...secondPage.page];
    const ids = combined.map((message) => message._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(combined.map((message) => message._creationTime)).toEqual(
      combined.map((message) => message._creationTime).sort((a, b) => a - b)
    );
  });

  test('paginates with a stable cursor when the bound comes from listPages', async () => {
    const { sessionId } = await createTestSession('conversation-slice-bound-cursor');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    for (let i = 0; i < 25; i++) {
      await insertTimelineMessage(chatroomId, 'builder', `reply ${i}`);
    }
    await insertTimelineMessage(chatroomId, 'user', 'next anchor');

    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId,
    });
    const endExclusive = pageNav.pages[0]!.endExclusive;
    expect(endExclusive).not.toBeNull();

    const firstPage = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive,
    });
    const secondPage = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
      endExclusive,
    });

    expect(firstPage.isDone).toBe(false);
    const ids = [...firstPage.page, ...secondPage.page].map((message) => message._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...firstPage.page, ...secondPage.page].at(-1)!._creationTime).toBeLessThan(
      endExclusive!
    );
  });

  test('returns every timeline row once when following continueCursor across filtered rows', async () => {
    const { sessionId } = await createTestSession('conversation-slice-pagination-complete');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    const expectedHandoffIds: Id<'chatroom_messages'>[] = [];
    const progressIds = new Set<Id<'chatroom_messages'>>();
    for (let i = 0; i < 120; i++) {
      expectedHandoffIds.push(
        await insertTimelineMessage(chatroomId, 'builder', `h${i}`, { type: 'handoff' })
      );
      progressIds.add(
        await insertTimelineMessage(chatroomId, 'builder', `p${i}`, { type: 'progress' })
      );
    }

    const collected: Id<'chatroom_messages'>[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const batch = await t.query(api.conversation.listPageMessages, {
        sessionId,
        chatroomId,
        pageId,
        paginationOpts: { numItems: 50, cursor },
        endExclusive: null,
      });
      collected.push(...batch.page.map((m) => m._id as Id<'chatroom_messages'>));
      cursor = batch.continueCursor;
      isDone = batch.isDone;
    }

    const collectedHandoffs = collected.filter((id) => id !== pageId);
    expect(collectedHandoffs).toEqual(expectedHandoffIds);
    expect(collectedHandoffs.some((id) => progressIds.has(id))).toBe(false);
  });
});

describe('listPageMessages — notice isolation', () => {
  test("a notice stays inside the page start's page and does not end it", async () => {
    const { sessionId } = await createTestSession('conversation-slice-notice');
    const chatroomId = await createChatroom(sessionId);

    const u1 = await insertTimelineMessage(chatroomId, 'user', 'U1 anchor');
    await seedActiveTask(chatroomId, 'builder');
    const noticeId = await sendNotice(sessionId, chatroomId, 'N notice inside U1 page');
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'U2 next user');

    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u1,
    });
    const u2CreationTime = await getMessageCreationTime(u2);
    const noticeCreationTime = await getMessageCreationTime(noticeId);
    expect(pageNav.nextPageId).toBe(u2);
    expect(pageNav.pages[0]!.endExclusive).toBe(u2CreationTime);
    expect(pageNav.pages[0]!.endExclusive).not.toBe(noticeCreationTime);

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId: u1,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });

    const ids = result.page.map((m) => m._id);
    const types = result.page.map((m) => m.type);
    expect(ids).toContain(u1);
    expect(ids).toContain(noticeId);
    expect(ids).not.toContain(u2);
    expect(ids.indexOf(u1)).toBeLessThan(ids.indexOf(noticeId));
    expect(types[ids.indexOf(noticeId)]).toBe('notice');

    const u1CreationTime = await getMessageCreationTime(u1);
    const tail = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: u1CreationTime,
      endExclusive: pageNav.pages[0]!.endExclusive,
    });
    expect(tail).not.toBeNull();
    const tailNotice = tail!.find((m) => m._id === noticeId);
    expect(tailNotice).toBeDefined();
    expect(tailNotice!.type).toBe('notice');
    expect(tail!.some((m) => m._id === u2)).toBe(false);
  });

  test('a notice sent after the next user message belongs to that page', async () => {
    const { sessionId } = await createTestSession('conversation-slice-notice-after');
    const chatroomId = await createChatroom(sessionId);

    const u1 = await insertTimelineMessage(chatroomId, 'user', 'U1 anchor');
    await seedActiveTask(chatroomId, 'builder');
    const u2 = await insertTimelineMessage(chatroomId, 'user', 'U2 next user');
    const noticeId = await sendNotice(sessionId, chatroomId, 'N2 notice after U2');

    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: u2,
    });
    expect(pageNav.nextPageId).toBeNull();

    const result = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId: u2,
      paginationOpts: { numItems: 10, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });

    const ids = result.page.map((m) => m._id);
    expect(ids).toContain(u2);
    expect(ids).toContain(noticeId);
    expect(ids).not.toContain(u1);
  });
});

describe('subscribePageTail', () => {
  test('returns new messages after the cursor within the page bound', async () => {
    const { sessionId } = await createTestSession('conversation-tail-new');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');

    const afterTime = await getMessageCreationTime(pageId);

    const result = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: afterTime,
      endExclusive: null,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]!.content).toBe('reply1');
  });

  test('returns null when no new messages follow the cursor', async () => {
    const { sessionId } = await createTestSession('conversation-tail-empty');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');

    const afterTime = await getMessageCreationTime(pageId);

    const result = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: afterTime,
      endExclusive: null,
    });

    expect(result).toBeNull();
  });

  test('excludes messages at or above endExclusive', async () => {
    const { sessionId } = await createTestSession('conversation-tail-upper');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    const nextUser = await insertTimelineMessage(chatroomId, 'user', 'next user');

    const after = await getMessageCreationTime(pageId);
    const upper = await getMessageCreationTime(nextUser);

    const result = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: after,
      endExclusive: upper,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0]!.content).toBe('reply1');
  });

  test('returns at most 100 rows', async () => {
    const { sessionId } = await createTestSession('conversation-tail-cap');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    for (let i = 0; i < 120; i++) {
      await insertTimelineMessage(chatroomId, 'builder', `reply ${i}`, { type: 'handoff' });
    }

    const after = await getMessageCreationTime(pageId);

    const result = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: after,
      endExclusive: null,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(100);
  });

  test('excludes join and progress rows from the tail', async () => {
    const { sessionId } = await createTestSession('conversation-tail-filter');
    const chatroomId = await createChatroom(sessionId);
    const pageId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply one');
    await insertTimelineMessage(chatroomId, 'builder', 'reply two');
    await insertTimelineMessage(chatroomId, 'builder', 'join event', { type: 'join' });
    await insertTimelineMessage(chatroomId, 'builder', 'progress update', { type: 'progress' });

    const after = await getMessageCreationTime(pageId);

    const result = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: after,
      endExclusive: null,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    for (const message of result!) {
      expect(message.type).not.toBe('join');
      expect(message.type).not.toBe('progress');
    }
  });
});

describe('readTimelineMessagesForTest', () => {
  test('returns timeline rows in ascending order and excludes join and progress', async () => {
    const { sessionId } = await createTestSession('conversation-timeline-order');
    const chatroomId = await createChatroom(sessionId);

    await insertTimelineMessage(chatroomId, 'user', 'first');
    await insertTimelineMessage(chatroomId, 'builder', 'handoff one', { type: 'handoff' });
    await insertTimelineMessage(chatroomId, 'builder', 'join event', { type: 'join' });
    await insertTimelineMessage(chatroomId, 'builder', 'progress update', { type: 'progress' });
    await insertTimelineMessage(chatroomId, 'user', 'second');

    const timeline = await readTimelineMessagesForTest(t, chatroomId);

    expect(timeline.map((message) => message.content)).toEqual(['first', 'handoff one', 'second']);
    expect(timeline.map((message) => message._creationTime)).toEqual(
      timeline.map((message) => message._creationTime).sort((a, b) => a - b)
    );
  });
});
