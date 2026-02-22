/**
 * Participant Join Integration Tests
 *
 * Tests for the participants.join mutation.
 * The heartbeat mutation was removed as part of the migration to lastSeenAt + lastSeenAction.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Join', () => {
  test('join writes lastSeenAction when provided', async () => {
    const { sessionId } = await createTestSession('test-join-action');
    const chatroomId = await createPairTeamChatroom(sessionId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'wait-for-task:started',
    });

    const participant = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(participant).not.toBeNull();
    expect(participant!.lastSeenAction).toBe('wait-for-task:started');
    expect(participant!.lastSeenAt).toBeDefined();
  });

  test('join without action does not set lastSeenAction', async () => {
    const { sessionId } = await createTestSession('test-join-no-action');
    const chatroomId = await createPairTeamChatroom(sessionId);

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
});
