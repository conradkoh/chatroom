/**
 * Tests for sendAutomatedUserMessage use case.
 * Verifies that explicit conversationMode snapshots are persisted correctly
 * on both direct (non-queued) and queued message/task paths, and that
 * legacy/no-mode callers retain live-config fallback behaviour.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'active task',
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    await ctx.db.insert('chatroom_taskCounts', {
      chatroomId,
      pending: 0,
      acknowledged: 0,
      inProgress: 1,
      completed: 0,
      queueSize: 0,
      backlogCount: 0,
      pendingReviewCount: 0,
    });
    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendAutomatedUserMessage — explicit conversationMode', () => {
  test('direct send with mode=chat persists conversationMode and plannerEnhancerEnabled=false', async () => {
    const { sessionId } = await createTestSession('auto-chat-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'chat mode message',
      type: 'message',
      conversationMode: 'chat',
    });

    // Verify the message was written to chatroom_messages (not queued)
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('chat mode message');

    // Verify the task has the mode snapshot
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('chat');
    expect(task?.plannerEnhancerEnabled).toBe(false);
  });

  test('direct send with mode=code persists conversationMode and plannerEnhancerEnabled=false', async () => {
    const { sessionId } = await createTestSession('auto-code-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'code mode message',
      type: 'message',
      conversationMode: 'code',
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('code');
    expect(task?.plannerEnhancerEnabled).toBe(false);
  });

  test('direct send with mode=code:enhanced persists conversationMode and plannerEnhancerEnabled=true', async () => {
    const { sessionId } = await createTestSession('auto-enhanced-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'enhanced mode message',
      type: 'message',
      conversationMode: 'code:enhanced',
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('code:enhanced');
    expect(task?.plannerEnhancerEnabled).toBe(true);
  });

  test('queued send with explicit mode persists conversationMode on queue row', async () => {
    const { sessionId } = await createTestSession('auto-chat-queued');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued chat mode',
      type: 'message',
      conversationMode: 'chat',
    });

    // Verify queued message has conversationMode
    const queuedMsg = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queuedMsg).toBeDefined();
    expect(queuedMsg?.conversationMode).toBe('chat');
    expect(queuedMsg?.plannerEnhancerEnabled).toBe(false);
  });

  test('legacy send without mode retains live-config fallback (no conversationMode persisted)', async () => {
    const { sessionId } = await createTestSession('auto-legacy-direct');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'legacy mode message',
      type: 'message',
      // No conversationMode — should use live-config fallback
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    // Without a user enhancer config, plannerEnhancerEnabled defaults to undefined/false
    expect(task?.conversationMode).toBeUndefined();
  });
});

describe('sendAutomatedUserMessage — persisted taskEnvelope', () => {
  test('direct send with mode=chat persists a complete envelope on the created task', async () => {
    const { sessionId } = await createTestSession('auto-env-chat-direct');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'chat envelope',
      type: 'message',
      conversationMode: 'chat',
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    });
  });

  test('direct send with mode=code persists a complete envelope on the created task', async () => {
    const { sessionId } = await createTestSession('auto-env-code-direct');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'code envelope',
      type: 'message',
      conversationMode: 'code',
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'entry' },
    });
  });

  test('direct send with mode=code:enhanced persists a complete envelope on the created task', async () => {
    const { sessionId } = await createTestSession('auto-env-enhanced-direct');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'enhanced envelope',
      type: 'message',
      conversationMode: 'code:enhanced',
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code:enhanced',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' },
    });
  });

  test('queued explicit mode send persists a complete envelope on the queue row', async () => {
    const { sessionId } = await createTestSession('auto-env-queued');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued envelope',
      type: 'message',
      conversationMode: 'chat',
    });

    const queuedMsg = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queuedMsg?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    });
  });

  test('startInNewSession true maps to sessionPolicy new; false/omitted map to continue', async () => {
    const { sessionId } = await createTestSession('auto-env-session-new');

    async function sendAndGetTask(content: string, startInNewSession?: boolean) {
      const chatroomId = await createChatroom(sessionId);
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content,
        type: 'message',
        conversationMode: 'chat',
        ...(startInNewSession !== undefined ? { startInNewSession } : {}),
      });
      const task = await t.run(async (ctx) => {
        return await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .first();
      });
      return task;
    }

    const newSessionTask = await sendAndGetTask('new session', true);
    const sameSessionTask = await sendAndGetTask('same session', false);
    const omittedSessionTask = await sendAndGetTask('omitted session');

    expect(newSessionTask?.taskEnvelope?.sessionPolicy).toBe('new');
    expect(sameSessionTask?.taskEnvelope?.sessionPolicy).toBe('continue');
    expect(omittedSessionTask?.taskEnvelope?.sessionPolicy).toBe('continue');
    // The scalar projection preserves the caller's explicit boolean incl. false.
    expect(newSessionTask?.startInNewSession).toBe(true);
    expect(sameSessionTask?.startInNewSession).toBe(false);
    expect(omittedSessionTask?.startInNewSession).toBeUndefined();
  });

  test('legacy no-mode send still yields a complete envelope from the enhancer-config fallback', async () => {
    const { sessionId } = await createTestSession('auto-env-legacy');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'legacy envelope',
      type: 'message',
      // No envelope and no mode → legacy live-config lookup resolves, and a
      // complete envelope must still be persisted.
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    // No enhancer config → resolved boolean is false → envelope mode is code.
    expect(task?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'entry' },
    });
    // Legacy scalar projections are preserved for the legacy caller path.
    expect(task?.conversationMode).toBeUndefined();
  });

  test('supplied explicit taskEnvelope wins over stale mode/enhancer/session scalars', async () => {
    const { sessionId } = await createTestSession('auto-env-explicit');
    const chatroomId = await createChatroom(sessionId);

    const explicitEnvelope = {
      version: 1 as const,
      conversationMode: 'chat' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'direct' as const, phase: 'entry' as const },
    };

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'explicit envelope wins',
      type: 'message',
      conversationMode: 'code:enhanced', // stale — envelope wins
      startInNewSession: false, // stale for the envelope — sessionPolicy stays new
      taskEnvelope: explicitEnvelope,
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.taskEnvelope).toEqual(explicitEnvelope);
    // Derived compatibility projections follow the envelope mode.
    expect(task?.conversationMode).toBe('chat');
    expect(task?.plannerEnhancerEnabled).toBe(false);
    // The caller's explicit startInNewSession scalar is preserved as a projection.
    expect(task?.startInNewSession).toBe(false);
  });

  test('listQueued returns a complete normalized envelope for a legacy queue row and an envelope row', async () => {
    const { sessionId } = await createTestSession('auto-env-list-queued');
    const chatroomId = await createChatroom(sessionId);

    // Legacy queue row: no taskEnvelope, only scalar policy fields.
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'legacy queued',
        type: 'message' as const,
        queuePosition: 1,
        conversationMode: 'chat',
        plannerEnhancerEnabled: false,
        startInNewSession: true,
      });
      // New envelope queue row.
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'envelope queued',
        type: 'message' as const,
        queuePosition: 2,
        taskEnvelope: {
          version: 1,
          conversationMode: 'code:enhanced',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' },
        },
      });
    });

    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    expect(queued.map((row) => row.content)).toEqual(['legacy queued', 'envelope queued']);

    // Legacy row is normalized to a complete envelope from its scalars.
    expect(queued[0]?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    });
    // New envelope row is returned as a complete, intact envelope.
    expect(queued[1]?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code:enhanced',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' },
    });
  });
});
