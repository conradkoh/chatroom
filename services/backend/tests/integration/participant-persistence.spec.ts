/**
 * Participant Persistence — End-to-End Integration Tests
 *
 * Verifies participant record lifecycle across exit/rejoin cycles,
 * multi-agent exit scenarios, and queue promotion with exited participants.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { areAllAgentsWaiting } from '../../convex/auth/cliSessionAuth';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

describe('Participant Persistence', () => {
  test('agent rejoins after exit — participant record is reactivated', async () => {
    const { sessionId } = await createTestSession('test-pp-rejoin');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      await ctx.db.patch(p!._id, { lastSeenAction: 'exited', connectionId: undefined });
    });

    // Rejoin with an action (simulates real agent reconnect via get-next-task)
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:connecting',
    });

    const participants = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .collect();
    });

    expect(participants.length).toBe(1);
    expect(participants[0]!.lastSeenAction).not.toBe('exited');
  });

  test('multiple agents exit independently — all records persist', async () => {
    const { sessionId } = await createTestSession('test-pp-multi-exit');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');
    await joinParticipant(sessionId, chatroomId, 'reviewer');

    await t.run(async (ctx) => {
      const participants = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      for (const p of participants) {
        await ctx.db.patch(p._id, { lastSeenAction: 'exited', connectionId: undefined });
      }
    });

    const participants = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    expect(participants.length).toBe(2);
    expect(participants.every((p) => p.lastSeenAction === 'exited')).toBe(true);
  });

  test('exited participant does not block queue promotion when entry point joins', async () => {
    const { sessionId } = await createTestSession('test-pp-queue-promo');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'reviewer');

    await t.run(async (ctx) => {
      const reviewer = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
        )
        .unique();
      await ctx.db.patch(reviewer!._id, { lastSeenAction: 'exited', connectionId: undefined });
    });

    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const builder = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      await ctx.db.patch(builder!._id, { lastSeenAction: 'get-next-task:started' });
    });

    const result = await t.run(async (ctx) => {
      return areAllAgentsWaiting(ctx, chatroomId);
    });
    expect(result).toBe(true);
  });

  test('exited agent lastSeenAt is preserved across multiple exit-rejoin cycles', async () => {
    const { sessionId } = await createTestSession('test-pp-lsa-cycles');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');

    const originalLastSeenAt = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return p!.lastSeenAt;
    });

    await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      await ctx.db.patch(p!._id, { lastSeenAction: 'exited', connectionId: undefined });
    });

    const afterExit = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return p!.lastSeenAt;
    });
    expect(afterExit).toBe(originalLastSeenAt);

    await new Promise((r) => setTimeout(r, 10));

    await joinParticipant(sessionId, chatroomId, 'builder');

    const afterRejoin = await t.run(async (ctx) => {
      const p = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return p!.lastSeenAt;
    });
    expect(afterRejoin).toBeGreaterThanOrEqual(originalLastSeenAt);
  });
});
