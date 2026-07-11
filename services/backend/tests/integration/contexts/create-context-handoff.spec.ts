/**
 * createContext — unrestricted creation integration tests
 *
 * Teams may create a new context at any time (including mid-task) without
 * requiring a handoff or trigger message since the previous context.
 */

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

describe('createContext — unrestricted creation', () => {
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

  test('solo: allows context new at any time without handoff or trigger', async () => {
    const { sessionId } = await createTestSession('solo-context-mid-task');
    const chatroomId = await createSoloChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Initial context',
      role: 'solo',
    });

    const contextId = await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Mid-task context refresh to stay on track',
      role: 'solo',
    });

    expect(contextId).toBeDefined();
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

  test('idempotent: same triggerMessageId returns existing context without duplicate new-context message', async () => {
    const { sessionId } = await createTestSession('solo-context-idempotent-trigger');
    const chatroomId = await createSoloChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    const userMessageId = await sendUserMessage(sessionId, chatroomId, 'Help me with auth');

    const firstContextId = await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'User needs help with authentication',
      role: 'solo',
      triggerMessageId: userMessageId,
    });

    const secondContextId = await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Duplicate attempt for same trigger',
      role: 'solo',
      triggerMessageId: userMessageId,
    });

    expect(secondContextId).toBe(firstContextId);

    const messages = await t.query(api.messageList.getLatestMessages, {
      sessionId,
      chatroomId,
      limit: 20,
    });

    const newContextMessages = messages.messages.filter((m) => m.type === 'new-context');
    expect(newContextMessages).toHaveLength(1);
    expect(newContextMessages[0]?.contextCreatedBy).toBe('solo');
  });
});
