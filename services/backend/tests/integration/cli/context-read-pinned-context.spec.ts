/**
 * Context Read — Pinned Context Integration Test
 *
 * Verifies that `getContextForRole` always includes the current pinned
 * context from `chatroom_contexts`, even when the message history is empty
 * (e.g., all messages are filtered out due to pending/acknowledged task status).
 *
 * This test was written TDD-style: first written to reproduce the bug where
 * `context read` returned "No context available" despite a context being pinned.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';

/**
 * Helper to create a test session and authenticate
 */
async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Helper to create a Squad team chatroom (planner can create contexts)
 */
async function createSquadTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'squad',
    teamName: 'Squad Team',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamEntryPoint: 'planner',
  });
  return chatroomId;
}

/**
 * Helper to join participants
 */
async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  const readyUntil = Date.now() + 10 * 60 * 1000;
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      readyUntil,
    });
  }
}

describe('Context Read — Pinned Context', () => {
  test('includes pinned context in response even when no messages exist', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-pinned-context-no-messages');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // Create a context (this pins it to the chatroom)
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Working on the login feature refactor',
      role: 'planner',
    });

    // ===== QUERY CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // The response should include the pinned context, even though the
    // message history only has a system "new-context" notification
    expect(context.currentContext).toBeDefined();
    expect(context.currentContext?.content).toBe('Working on the login feature refactor');
    expect(context.currentContext?.createdBy).toBe('planner');
  });

  test('includes pinned context even when all messages are filtered out', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-pinned-context-all-filtered');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // Create a context
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Fixing authentication flow',
      role: 'planner',
    });

    // User sends a message (creates a pending task for planner)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you fix the auth flow?',
      type: 'message',
    });

    // At this point, the user message has a pending task, which gets
    // filtered out by getContextForRole. The only remaining message is
    // the system "new-context" notification.

    // ===== QUERY CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // Even if messages array is empty after filtering, the pinned context
    // should always be present in the response
    expect(context.currentContext).toBeDefined();
    expect(context.currentContext?.content).toBe('Fixing authentication flow');
  });

  test('returns null currentContext when no context has been pinned', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-no-pinned-context');
    const chatroomId = await createSquadTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

    // ===== QUERY CONTEXT (no context created) =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // Should be null when no context is pinned
    expect(context.currentContext).toBeNull();
  });
});
