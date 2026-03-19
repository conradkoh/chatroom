/**
 * Participant Routing with Exited Participants — Integration Tests
 *
 * Verifies that exited participants are correctly excluded from
 * handoff target lists and chatroom agent presence arrays.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

describe('Participant Routing with Exited Participants', () => {
  test('getAllowedHandoffRoles excludes exited participants', async () => {
    const { sessionId } = await createTestSession('test-route-exited-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');
    await joinParticipant(sessionId, chatroomId, 'reviewer');

    await t.run(async (ctx) => {
      const reviewer = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
        )
        .unique();
      await ctx.db.patch(reviewer!._id, { lastSeenAction: 'exited' });
    });

    const result = await t.query(api.messages.getAllowedHandoffRoles, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.availableRoles.some((r: string) => r === 'reviewer')).toBe(false);
  });

  test('getAllowedHandoffRoles includes active participants', async () => {
    const { sessionId } = await createTestSession('test-route-active-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');
    await joinParticipant(sessionId, chatroomId, 'reviewer');

    const result = await t.query(api.messages.getAllowedHandoffRoles, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result.availableRoles.some((r: string) => r === 'reviewer')).toBe(true);
  });

  test('listByUserWithStatus excludes exited participants from agents array', async () => {
    const { sessionId } = await createTestSession('test-list-exited-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const builder = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      await ctx.db.patch(builder!._id, { lastSeenAction: 'exited' });
    });

    const chatrooms = await t.query(api.chatrooms.listByUserWithStatus, { sessionId });
    const room = chatrooms.find((c: { _id: string }) => c._id === chatroomId);

    expect(room).toBeDefined();
    expect(room!.agents.some((a: { role: string }) => a.role === 'builder')).toBe(false);
  });

  test('listByUserWithStatus includes active participants in agents array', async () => {
    const { sessionId } = await createTestSession('test-list-active-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await joinParticipant(sessionId, chatroomId, 'builder');

    const chatrooms = await t.query(api.chatrooms.listByUserWithStatus, { sessionId });
    const room = chatrooms.find((c: { _id: string }) => c._id === chatroomId);

    expect(room).toBeDefined();
    expect(room!.agents.some((a: { role: string }) => a.role === 'builder')).toBe(true);
  });
});
