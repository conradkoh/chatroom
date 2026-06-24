/**
 * Participant Join Integration Tests
 *
 * Tests for the participants.join mutation.
 * The heartbeat mutation was removed as part of the migration to lastSeenAt + lastSeenAction.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createBuilderEntryDuoChatroom } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Join', () => {
  test('join writes lastSeenAction when provided', async () => {
    const { sessionId } = await createTestSession('test-join-action');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(participant).not.toBeNull();
    expect(participant!.lastSeenAction).toBe('get-next-task:started');
    expect(participant!.lastSeenAt).toBeDefined();
  });

  test('join without action does not set lastSeenAction', async () => {
    const { sessionId } = await createTestSession('test-join-no-action');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(participant).not.toBeNull();
    expect(participant!.lastSeenAction).toBeUndefined();
  });

  test('rapid joins within throttle window do not update lastSeenAt', async () => {
    const { sessionId } = await createTestSession('test-join-throttle');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const afterFirst = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return p!.lastSeenAt;
    });

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const afterSecond = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return p!.lastSeenAt;
    });

    expect(afterSecond).toBe(afterFirst);
  });

  test('join with action still updates lastSeenAction when lastSeenAt is throttled', async () => {
    const { sessionId } = await createTestSession('test-join-throttle-action');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(participant!.lastSeenAction).toBe('get-next-task:started');
  });

  test('join with unchanged action does not patch within throttle window', async () => {
    const { sessionId } = await createTestSession('test-join-noop-action');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const afterFirst = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return { lastSeenAt: p!.lastSeenAt, lastSeenAction: p!.lastSeenAction };
    });

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    const afterSecond = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return { lastSeenAt: p!.lastSeenAt, lastSeenAction: p!.lastSeenAction };
    });

    expect(afterSecond).toEqual(afterFirst);
  });
});
