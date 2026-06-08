/**
 * getPendingTasksForRole — connection_closed terminate behavior (integration tests)
 *
 * When an agent goes offline, its connectionId is moved to exitedConnectionId.
 * A still-subscribed get-next-task loop with that exact connectionId must
 * receive { type: 'connection_closed' } and exit cleanly. A restarting agent
 * with a fresh connectionId must NOT be terminated.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom } from '../helpers/integration';

/** Join a participant with a specific connectionId for testing superseded/closed detection. */
async function joinWithConnectionId(
  sessionId: Parameters<typeof t.mutation>[1]['sessionId'],
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  connectionId: string
): Promise<void> {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
    connectionId,
  });
}

describe('getPendingTasksForRole — connection_closed terminate', () => {
  test('terminates a stale loop whose connectionId was exited', async () => {
    const { sessionId } = await createTestSession('conn-closed-terminate-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Join with connectionId 'conn-A'
    await joinWithConnectionId(sessionId, chatroomId, 'builder', 'conn-A');

    // Simulate agent exit: set exitedConnectionId, clear connectionId
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (!participant) throw new Error('participant not found');
      await ctx.db.patch('chatroom_participants', participant._id, {
        connectionId: undefined,
        exitedConnectionId: 'conn-A',
      });
    });

    // Stale loop with exited connectionId → should terminate
    const response = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-A',
    });
    expect(response.type).toBe('connection_closed');
  });

  test('does NOT terminate a restarted agent with a different connectionId', async () => {
    const { sessionId } = await createTestSession('conn-closed-no-kill-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Join with connectionId 'conn-A', then simulate exit
    await joinWithConnectionId(sessionId, chatroomId, 'builder', 'conn-A');
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (!participant) throw new Error('participant not found');
      await ctx.db.patch('chatroom_participants', participant._id, {
        connectionId: undefined,
        exitedConnectionId: 'conn-A',
      });
    });

    // Restarted agent uses a fresh connectionId 'conn-B' → must NOT get connection_closed
    const response = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-B',
    });
    expect(response.type).not.toBe('connection_closed');
  });

  test('join clears exitedConnectionId when a new connection establishes', async () => {
    const { sessionId } = await createTestSession('conn-closed-join-clears-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Join with 'conn-A', then record exit
    await joinWithConnectionId(sessionId, chatroomId, 'builder', 'conn-A');
    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (!participant) throw new Error('participant not found');
      await ctx.db.patch('chatroom_participants', participant._id, {
        connectionId: undefined,
        exitedConnectionId: 'conn-A',
      });
    });

    // Agent restarts with new connectionId 'conn-B' via participants.join
    await joinWithConnectionId(sessionId, chatroomId, 'builder', 'conn-B');

    // exitedConnectionId must be cleared
    const participant = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
    });
    expect(participant?.exitedConnectionId).toBeUndefined();
    expect(participant?.connectionId).toBe('conn-B');
  });
});
