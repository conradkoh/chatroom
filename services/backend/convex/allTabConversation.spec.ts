import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
    visibleInAllTabOnly?: boolean | undefined;
  }
): Promise<Id<'chatroom_messages'>> {
  return await t.run(async (ctx) => {
    return (await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole,
      content,
      type: extra?.type ?? 'message',
      ...(extra?.targetRole ? { targetRole: extra.targetRole } : {}),
      ...(extra?.visibleInAllTabOnly ? { visibleInAllTabOnly: true } : {}),
    })) as Id<'chatroom_messages'>;
  });
}

describe('getAllTabAnchorNavigation', () => {
  test('returns all null when no messages exist', async () => {
    const { sessionId } = await createTestSession('alltab-nav-empty');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
    });

    expect(result.anchor).toBeNull();
    expect(result.prevAnchorId).toBeNull();
    expect(result.nextAnchorId).toBeNull();
  });

  test('defaults to latest user message when no anchorMessageId; prev/next correct for 3 user messages', async () => {
    const { sessionId } = await createTestSession('alltab-nav-3');
    const chatroomId = await createChatroom(sessionId);

    await insertTimelineMessage(chatroomId, 'user', 'oldest msg');
    const m2 = await insertTimelineMessage(chatroomId, 'user', 'middle msg');
    const m3 = await insertTimelineMessage(chatroomId, 'user', 'newest msg');

    const result = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
    });

    expect(result.anchor).not.toBeNull();
    expect(result.anchor!._id).toBe(m3);
    expect(result.anchor!.contentPreview).toBe('newest msg');
    expect(result.prevAnchorId).toBe(m2);
    expect(result.nextAnchorId).toBeNull();
    expect(result.sliceUpperBoundExclusive).toBeNull();
  });

  test('respects explicit anchorMessageId and resolves adjacent anchors', async () => {
    const { sessionId } = await createTestSession('alltab-nav-explicit');
    const chatroomId = await createChatroom(sessionId);

    const m1 = await insertTimelineMessage(chatroomId, 'user', 'first');
    await insertTimelineMessage(chatroomId, 'builder', 'agent reply');
    const m3 = await insertTimelineMessage(chatroomId, 'user', 'second');
    const m4 = await insertTimelineMessage(chatroomId, 'user', 'third');

    const result = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
      anchorMessageId: m3 as Id<'chatroom_messages'>,
    });

    expect(result.anchor!._id).toBe(m3);
    expect(result.anchor!.contentPreview).toBe('second');
    expect(result.prevAnchorId).toBe(m1);
    expect(result.nextAnchorId).toBe(m4);
    expect(result.sliceUpperBoundExclusive).not.toBeNull();
  });

  test('throws when anchorMessageId is not a user message', async () => {
    const { sessionId } = await createTestSession('alltab-nav-notuser');
    const chatroomId = await createChatroom(sessionId);
    const builderMsg = await insertTimelineMessage(chatroomId, 'builder', 'builder msg');

    await expect(
      t.query(api.allTabConversation.getAllTabAnchorNavigation, {
        sessionId,
        chatroomId,
        anchorMessageId: builderMsg as Id<'chatroom_messages'>,
      })
    ).rejects.toThrow();
  });
});

describe('listAllTabSlicePaginated', () => {
  test('defaults sliceUpperBoundExclusive to null when field is omitted', async () => {
    const { sessionId } = await createTestSession('alltab-slice-omit-bound');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply');
    await insertTimelineMessage(chatroomId, 'user', 'next user');

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply');
    expect(contents).toContain('next user');
    expect(result.sliceMetadata.upperBoundExclusive).toBeNull();
  });

  test('returns anchor + replies, excludes next user message', async () => {
    const { sessionId } = await createTestSession('alltab-slice-basic');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    await insertTimelineMessage(chatroomId, 'planner', 'reply2');
    await insertTimelineMessage(chatroomId, 'user', 'next user');
    const navigation = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
    });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: navigation.sliceUpperBoundExclusive,
    });

    expect(result.sliceMetadata.upperBoundExclusive).not.toBeNull();
    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply1');
    expect(contents).toContain('reply2');
    expect(contents).not.toContain('next user');
  });

  test('user message ends previous slice', async () => {
    const { sessionId } = await createTestSession('alltab-slice-followup');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'work');
    await insertTimelineMessage(chatroomId, 'user', 'follow up');
    const navigation = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
    });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: navigation.sliceUpperBoundExclusive,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('work');
    expect(contents).not.toContain('follow up');
  });

  test('next user message provides correct sliceUpperBoundExclusive', async () => {
    const { sessionId } = await createTestSession('alltab-slice-bound-fu');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'work');
    const followUpId = await insertTimelineMessage(chatroomId, 'user', 'follow up');

    const followUpTime = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', followUpId as Id<'chatroom_messages'>);
      return msg!._creationTime;
    });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: followUpTime,
    });

    expect(result.sliceMetadata.upperBoundExclusive).toBe(followUpTime);
    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('work');
    expect(contents).not.toContain('follow up');
  });

  test('bounded slice via explicit sliceUpperBoundExclusive arg', async () => {
    const { sessionId } = await createTestSession('alltab-slice-explicit');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    const nextUser = await insertTimelineMessage(chatroomId, 'user', 'next user');
    await insertTimelineMessage(chatroomId, 'builder', 'after page');

    const bound = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', nextUser as Id<'chatroom_messages'>);
      return msg!._creationTime;
    });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: bound,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply1');
    expect(contents).not.toContain('next user');
    expect(contents).not.toContain('after page');
  });

  test('bounded slice excludes messages after page end', async () => {
    const { sessionId } = await createTestSession('alltab-slice-postbound');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'in-slice reply');
    await insertTimelineMessage(chatroomId, 'user', 'next user msg');
    for (let i = 0; i < 20; i++) {
      await insertTimelineMessage(chatroomId, 'builder', `post-page ${i}`);
    }
    const navigation = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
    });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: navigation.sliceUpperBoundExclusive,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('in-slice reply');
    expect(contents).not.toContain('next user msg');
    expect(contents).not.toContain('post-page');
  });

  test('excludes join and progress messages', async () => {
    const { sessionId } = await createTestSession('alltab-slice-exclude');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply', { type: 'message' });
    await insertTimelineMessage(chatroomId, 'builder', 'join event', { type: 'join' });
    await insertTimelineMessage(chatroomId, 'builder', 'progress update', { type: 'progress' });

    const result = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: null,
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply');
    expect(contents).not.toContain('join event');
    expect(contents).not.toContain('progress update');
  });

  test('paginates with stable cursor when sliceUpperBoundExclusive is null', async () => {
    const { sessionId } = await createTestSession('alltab-slice-null-cursor');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    for (let i = 0; i < 35; i++) {
      await insertTimelineMessage(
        chatroomId,
        'builder',
        `reply ${i}`,
        i % 3 === 0 ? { type: 'join' } : undefined
      );
    }

    const firstPage = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: null,
    });
    const secondPage = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
      sliceUpperBoundExclusive: null,
    });

    expect(firstPage.isDone).toBe(false);
    const ids = [...firstPage.page, ...secondPage.page].map((message) => message._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...firstPage.page, ...secondPage.page].map((message) => message._creationTime)).toEqual(
      [...firstPage.page, ...secondPage.page]
        .map((message) => message._creationTime)
        .sort((a, b) => a - b)
    );
  });

  test('paginates with stable cursor when bound comes from navigation', async () => {
    const { sessionId } = await createTestSession('alltab-slice-bound-cursor');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    for (let i = 0; i < 25; i++) {
      await insertTimelineMessage(chatroomId, 'builder', `reply ${i}`);
    }
    await insertTimelineMessage(chatroomId, 'user', 'next anchor');

    const navigation = await t.query(api.allTabConversation.getAllTabAnchorNavigation, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
    });
    expect(navigation.sliceUpperBoundExclusive).not.toBeNull();

    const firstPage = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
      paginationOpts: { numItems: 10, cursor: null },
      sliceUpperBoundExclusive: navigation.sliceUpperBoundExclusive,
    });
    const secondPage = await t.query(api.allTabConversation.listAllTabSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId,
      paginationOpts: { numItems: 10, cursor: firstPage.continueCursor },
      sliceUpperBoundExclusive: navigation.sliceUpperBoundExclusive,
    });

    expect(firstPage.isDone).toBe(false);
    expect(firstPage.sliceMetadata.upperBoundExclusive).toBe(navigation.sliceUpperBoundExclusive);
    expect(secondPage.sliceMetadata.upperBoundExclusive).toBe(navigation.sliceUpperBoundExclusive);
    const ids = [...firstPage.page, ...secondPage.page].map((message) => message._id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('subscribeAllTabSliceTail', () => {
  test('returns new messages after cursor within upper bound', async () => {
    const { sessionId } = await createTestSession('alltab-tail-new');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');

    const afterTime = await t.run(async (ctx) => {
      const anchor = await ctx.db.get('chatroom_messages', anchorId as Id<'chatroom_messages'>);
      return anchor!._creationTime;
    });

    const result = await t.query(api.allTabConversation.subscribeAllTabSliceTail, {
      sessionId,
      chatroomId,
      afterCreationTime: afterTime,
      upperBoundExclusive: null,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].content).toBe('reply1');
  });

  test('returns null when no new messages after cursor', async () => {
    const { sessionId } = await createTestSession('alltab-tail-empty');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');

    const afterTime = await t.run(async (ctx) => {
      const anchor = await ctx.db.get('chatroom_messages', anchorId as Id<'chatroom_messages'>);
      return anchor!._creationTime;
    });

    const result = await t.query(api.allTabConversation.subscribeAllTabSliceTail, {
      sessionId,
      chatroomId,
      afterCreationTime: afterTime,
      upperBoundExclusive: null,
    });

    expect(result).toBeNull();
  });

  test('excludes messages at or above upperBoundExclusive', async () => {
    const { sessionId } = await createTestSession('alltab-tail-upper');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    const nextUser = await insertTimelineMessage(chatroomId, 'user', 'next user');

    const meta = await t.run(async (ctx) => {
      const anchor = await ctx.db.get('chatroom_messages', anchorId as Id<'chatroom_messages'>);
      const next = await ctx.db.get('chatroom_messages', nextUser as Id<'chatroom_messages'>);
      return {
        after: anchor!._creationTime,
        upper: next!._creationTime,
      };
    });

    const result = await t.query(api.allTabConversation.subscribeAllTabSliceTail, {
      sessionId,
      chatroomId,
      afterCreationTime: meta.after,
      upperBoundExclusive: meta.upper,
    });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].content).toBe('reply1');
  });
});
