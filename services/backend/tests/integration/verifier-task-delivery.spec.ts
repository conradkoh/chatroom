/**
 * Entry-point verifier gate — Integration Tests
 *
 * End-to-end `getTaskDeliveryPrompt` coverage for the verifier gate: an
 * entry-point role in `code` and `code:enhanced` modes is told to obtain a
 * `verifier` review before delivering to the user, while `chat` mode and the
 * verifier's own return delivery are exempt. Covers both the duo planner
 * (rework delegates to `builder`) and the solo entry point (rework is done by
 * the entry point itself).
 *
 * The gate is prompt policy only; the inlined `<handoff-templates>` advertise
 * the verifier capability regardless of mode, so the chat case asserts only the
 * gate's absence, not the template's.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession, setupSoloWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { joinParticipant } from '../helpers/integration';

/** Advertise `verifier` as a configured duo capability for this chatroom. */
async function addVerifierToDuoTeamRoles(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await addTeamRoles(chatroomId, ['planner', 'builder', 'verifier']);
}

/** Advertise `verifier` as a configured solo capability (no builder) for this chatroom. */
async function addVerifierToSoloTeamRoles(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await addTeamRoles(chatroomId, ['solo', 'verifier']);
}

async function addTeamRoles(chatroomId: Id<'chatroom_rooms'>, roles: string[]): Promise<void> {
  await t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (!room) return;
    const next = new Set(room.teamRoles ?? []);
    for (const role of roles) next.add(role);
    await ctx.db.patch(chatroomId, { teamRoles: [...next] });
  });
}

async function createEntryPointTaskFromUserMessage(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  conversationMode: 'chat' | 'code' | 'code:enhanced',
  targetRole: 'planner' | 'solo'
): Promise<{ messageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  const messageId = await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content,
    targetRole,
    type: 'message',
    conversationMode,
  });

  const task = await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) => q.eq(q.field('sourceMessageId'), messageId))
      .first();
  });
  if (!task) throw new Error('missing user-origin task');

  return { messageId, taskId: task._id };
}

async function getDeliveryPrompt(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: 'planner' | 'solo',
  taskId: Id<'chatroom_tasks'>,
  messageId: Id<'chatroom_messages'>
): Promise<string> {
  const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
    sessionId,
    chatroomId,
    role,
    taskId,
    messageId,
    convexUrl: 'http://127.0.0.1:3210',
  });
  return fullCliOutput;
}

describe('getTaskDeliveryPrompt — duo planner verifier gate', () => {
  test.each([['code' as const], ['code:enhanced' as const]])(
    'entry-point planner in %s mode is told to obtain a verifier review',
    async (conversationMode) => {
      const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession(
        `verifier-gate-${conversationMode.replace(':', '-')}`
      );
      await addVerifierToDuoTeamRoles(chatroomId);
      await joinParticipant(sessionId, chatroomId, 'planner');

      const { messageId, taskId } = await createEntryPointTaskFromUserMessage(
        sessionId,
        chatroomId,
        'Add dark mode to settings',
        conversationMode,
        'planner'
      );

      const output = await getDeliveryPrompt(sessionId, chatroomId, 'planner', taskId, messageId);

      expect(output).toContain('<verifier-gate>');
      expect(output).toContain('delegate to `builder`, then request round 2');
      expect(output).toContain('### Handoff to `verifier`');
      expect(output).toContain('--next-role="verifier"');
    }
  );

  test('Chat mode omits the verifier gate', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession('verifier-gate-chat');
    await addVerifierToDuoTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createEntryPointTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Keep this conversational',
      'chat',
      'planner'
    );

    const output = await getDeliveryPrompt(sessionId, chatroomId, 'planner', taskId, messageId);

    expect(output).toContain('<chat-mode>');
    expect(output).not.toContain('<verifier-gate>');
  });

  test('verifier return delivery hands back to planner without the gate', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession('verifier-gate-return');
    await addVerifierToDuoTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'verifier');

    const { taskId } = await createEntryPointTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Ship the feature',
      'code',
      'planner'
    );
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { status: 'in_progress' });
    });

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'verifier',
      content: 'Verify the feature against the logs',
    });
    expect(handoff.success).toBe(true);
    const verifierTaskId = handoff.newTaskId;
    if (!verifierTaskId) throw new Error('missing verifier task');

    const handoffMessage = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .filter((q) => q.eq(q.field('senderRole'), 'planner'))
        .first();
    });
    if (!handoffMessage) throw new Error('missing planner handoff message');

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'verifier',
      taskId: verifierTaskId,
      messageId: handoffMessage._id,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(fullCliOutput).toContain('### Handoff to `planner`');
    expect(fullCliOutput).not.toContain('<verifier-gate>');
  });
});

describe('getTaskDeliveryPrompt — solo entry-point verifier gate', () => {
  test.each([['code' as const], ['code:enhanced' as const]])(
    'solo entry point in %s mode is told to obtain a verifier review and rework itself',
    async (conversationMode) => {
      const { sessionId, chatroomId } = await setupSoloWorkspaceForSession(
        `solo-verifier-gate-${conversationMode.replace(':', '-')}`
      );
      await addVerifierToSoloTeamRoles(chatroomId);
      await joinParticipant(sessionId, chatroomId, 'solo');

      const { messageId, taskId } = await createEntryPointTaskFromUserMessage(
        sessionId,
        chatroomId,
        'Ship the solo feature',
        conversationMode,
        'solo'
      );

      const output = await getDeliveryPrompt(sessionId, chatroomId, 'solo', taskId, messageId);

      expect(output).toContain('<verifier-gate>');
      expect(output).toContain('do it yourself, then request round 2');
      expect(output).not.toContain('delegate to `builder`');
      expect(output).toContain('### Handoff to `verifier`');
      expect(output).toContain('--next-role="verifier"');
    }
  );

  test('solo Chat mode omits the verifier gate', async () => {
    const { sessionId, chatroomId } = await setupSoloWorkspaceForSession('solo-verifier-gate-chat');
    await addVerifierToSoloTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    const { messageId, taskId } = await createEntryPointTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Keep this conversational',
      'chat',
      'solo'
    );

    const output = await getDeliveryPrompt(sessionId, chatroomId, 'solo', taskId, messageId);

    expect(output).toContain('<chat-mode>');
    expect(output).not.toContain('<verifier-gate>');
  });
});
