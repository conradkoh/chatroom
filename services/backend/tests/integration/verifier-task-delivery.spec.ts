/**
 * Planner verifier gate — Integration Tests
 *
 * End-to-end `getTaskDeliveryPrompt` coverage for the verifier gate: an
 * entry-point planner in `code` and `code:enhanced` modes is told to obtain a
 * `verifier` review before delivering to the user, while `chat` mode and the
 * verifier's own return delivery are exempt.
 *
 * The gate is prompt policy only; the inlined `<handoff-templates>` advertise
 * the verifier capability regardless of mode, so the chat case asserts only the
 * gate's absence, not the template's.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { joinParticipant } from '../helpers/integration';

/** Advertise `verifier` as a configured duo capability for this chatroom. */
async function addVerifierToTeamRoles(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (!room) return;
    const roles = new Set(room.teamRoles ?? []);
    roles.add('planner');
    roles.add('builder');
    roles.add('verifier');
    await ctx.db.patch(chatroomId, { teamRoles: [...roles] });
  });
}

async function createPlannerTaskFromUserMessage(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  conversationMode: 'chat' | 'code' | 'code:enhanced'
): Promise<{ messageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  const messageId = await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content,
    targetRole: 'planner',
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

async function getPlannerDeliveryPrompt(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  taskId: Id<'chatroom_tasks'>,
  messageId: Id<'chatroom_messages'>
): Promise<string> {
  const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
    sessionId,
    chatroomId,
    role: 'planner',
    taskId,
    messageId,
    convexUrl: 'http://127.0.0.1:3210',
  });
  return fullCliOutput;
}

describe('getTaskDeliveryPrompt — planner verifier gate', () => {
  test.each([['code' as const], ['code:enhanced' as const]])(
    'entry-point planner in %s mode is told to obtain a verifier review',
    async (conversationMode) => {
      const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession(
        `verifier-gate-${conversationMode.replace(':', '-')}`
      );
      await addVerifierToTeamRoles(chatroomId);
      await joinParticipant(sessionId, chatroomId, 'planner');

      const { messageId, taskId } = await createPlannerTaskFromUserMessage(
        sessionId,
        chatroomId,
        'Add dark mode to settings',
        conversationMode
      );

      const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

      expect(output).toContain('<verifier-gate>');
      expect(output).toContain('### Handoff to `verifier`');
      expect(output).toContain('--next-role="verifier"');
    }
  );

  test('Chat mode omits the verifier gate', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession('verifier-gate-chat');
    await addVerifierToTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Keep this conversational',
      'chat'
    );

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).toContain('<chat-mode>');
    expect(output).not.toContain('<verifier-gate>');
  });

  test('verifier return delivery hands back to planner without the gate', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession('verifier-gate-return');
    await addVerifierToTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'verifier');

    const { taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Ship the feature',
      'code'
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
