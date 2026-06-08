/**
 * listByUserV2 — Integration Tests
 *
 * Verifies that listByUserV2 folds the per-user read cursor (lastViewedAt)
 * into the base chatroom row correctly:
 *  1. Returns null before the user has ever opened the chatroom.
 *  2. Returns the cursor timestamp after markAsRead is called.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

describe('listByUserV2', () => {
  test('returns lastViewedAt: null for a chatroom never opened', async () => {
    const { sessionId } = await createTestSession('list-v2-null-1');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    const rooms = await t.query(api.chatrooms.listByUserV2, { sessionId });
    const room = rooms.find((r) => r._id === chatroomId);
    expect(room).toBeDefined();
    expect(room?.lastViewedAt).toBeNull();
  });

  test('returns cursor timestamp after markAsRead is called', async () => {
    const { sessionId } = await createTestSession('list-v2-cursor-1');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    // Before opening: null
    let rooms = await t.query(api.chatrooms.listByUserV2, { sessionId });
    expect(rooms.find((r) => r._id === chatroomId)?.lastViewedAt).toBeNull();

    // Simulate opening the chatroom (markAsRead updates the read cursor)
    await t.mutation(api.chatrooms.markAsRead, { sessionId, chatroomId });

    // After opening: should be a number (the cursor's lastSeenAt)
    rooms = await t.query(api.chatrooms.listByUserV2, { sessionId });
    const room = rooms.find((r) => r._id === chatroomId);
    expect(room).toBeDefined();
    expect(typeof room?.lastViewedAt).toBe('number');
  });
});
