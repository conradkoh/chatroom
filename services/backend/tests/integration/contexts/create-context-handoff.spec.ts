/**
 * createContext handoff guard — integration tests
 *
 * Verifies when CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT is raised vs allowed.
 * Solo (and duo) agents create context on each new user message via triggerMessageId
 * even when no handoff was sent since the previous context.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';
import { createTestSession, joinParticipant } from '../../helpers/integration';

async function createSoloChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'solo',
    teamName: 'Solo Team',
    teamRoles: ['solo'],
    teamEntryPoint: 'solo',
  });
}

async function sendUserMessage(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  targetRole = 'solo'
): Promise<Id<'chatroom_messages'>> {
  return await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content,
    targetRole,
    type: 'message',
  });
}

describe('createContext — handoff guard', () => {
  test('solo: allows context new for a new user message without prior handoff', async () => {
    const { sessionId } = await createTestSession('solo-context-new-user-trigger');
    const chatroomId = await createSoloChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'User greeted the assistant. No specific task requested yet.',
      role: 'solo',
    });

    const secondUserMessageId = await sendUserMessage(
      sessionId,
      chatroomId,
      'Can you help me with something?'
    );

    const contextId = await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'User asked for help with a new task.',
      role: 'solo',
      triggerMessageId: secondUserMessageId,
    });

    expect(contextId).toBeDefined();
  });

  test('solo: blocks redundant context new without handoff or new user trigger', async () => {
    const { sessionId } = await createTestSession('solo-context-no-trigger');
    const chatroomId = await createSoloChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Initial greeting context',
      role: 'solo',
    });

    await expect(
      t.mutation(api.contexts.createContext, {
        sessionId,
        chatroomId,
        content: 'Redundant context without trigger',
        role: 'solo',
      })
    ).rejects.toThrow(ConvexError);
  });

  test('duo planner: allows context new when triggerMessageId is a newer user message', async () => {
    const { sessionId } = await createTestSession('duo-context-new-user-trigger');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'First user request context',
      role: 'planner',
    });

    const followUpMessageId = await sendUserMessage(
      sessionId,
      chatroomId,
      'Follow-up before handoff',
      'planner'
    );

    const contextId = await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Follow-up user message context',
      role: 'planner',
      triggerMessageId: followUpMessageId,
    });

    expect(contextId).toBeDefined();
  });
});
