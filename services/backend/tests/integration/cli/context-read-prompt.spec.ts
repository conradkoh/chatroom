/**
 * Context Read Command Integration Tests
 *
 * Tests the output format of the `chatroom context read` command,
 * ensuring task content and attached tasks are properly displayed.
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
 * Helper to create a Pair team chatroom
 */
async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
  return chatroomId;
}

/**
 * Helper to join participants to the chatroom
 */
async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  const readyUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      readyUntil,
    });
  }
}

describe('Context Read Command Output', () => {
  test('materializes complete context with task content and attached tasks', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-context-with-attachments');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog task
    const backlogResult = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content:
        'Bug: Missing CLI command to update status of backlog task to pending user review\n\nIn the CLI, an agent reflected that they were unable to mark a task as pending_user_review. To verify if this is true or it is a regression.',
      createdBy: 'user',
      isBacklog: true,
    });
    const backlogTaskId = backlogResult.taskId;

    // User sends message with backlog attachment
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content:
        'can you help to find the code related to this issue? I want to change the way that "failures" are handled by the agent',
      type: 'message',
      attachedTaskIds: [backlogTaskId],
    });

    // Builder claims and starts the task
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const startResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Classify the task
    await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'question',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Builder hands off to user
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content:
        "I found the code related to failure handling in the agent system. Here's what currently exists:\n\n[analysis content]",
      targetRole: 'user',
    });

    // ===== GET CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // ===== VERIFY BACKEND DATA =====
    // The backend should provide all necessary data for the CLI to format correctly

    // Verify origin message exists
    expect(context.originMessage).toBeDefined();
    expect(context.originMessage?.classification).toBe('question');

    // Verify messages array has content
    expect(context.messages.length).toBeGreaterThan(0);

    const userMessage = context.messages.find((m) => m._id === userMessageId);
    expect(userMessage).toBeDefined();

    // ===== CRITICAL: These fields should exist and are now fixed =====

    // 1. Task content should be included
    expect(userMessage!.taskContent).toBeDefined();
    expect(userMessage!.taskContent).toContain('can you help to find the code');

    // 2. Attached tasks should be enriched objects (not just IDs)
    expect(userMessage!.attachedTasks).toBeDefined();
    expect(Array.isArray(userMessage!.attachedTasks)).toBe(true);
    expect(userMessage!.attachedTasks?.length).toBe(1);

    const attachedTask = userMessage!.attachedTasks?.[0];
    expect(attachedTask).toBeDefined();
    expect(attachedTask?._id).toBe(backlogTaskId);
    expect(attachedTask?.content).toBeDefined();
    expect(attachedTask?.content).toContain('Bug: Missing CLI command');
    expect(attachedTask?.status).toBeDefined();
  });

  test('shows proper formatting when task has no attachments', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-context-no-attachments');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends simple message without attachments
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'How does authentication work?',
      type: 'message',
    });

    // Get context
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const userMessage = context.messages.find((m) => m.senderRole === 'user');
    expect(userMessage).toBeDefined();

    // Should NOT have attachedTasks if no attachments
    expect(userMessage!.attachedTasks).toBeUndefined();
  });

  test('handles multiple attached tasks correctly', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-context-multiple-attachments');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create multiple backlog tasks
    const task1 = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Task 1: Fix login bug',
      createdBy: 'user',
      isBacklog: true,
    });

    const task2 = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Task 2: Update documentation',
      createdBy: 'user',
      isBacklog: true,
    });

    // User sends message with multiple attachments
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you work on these two items?',
      type: 'message',
      attachedTaskIds: [task1.taskId, task2.taskId],
    });

    // Get context
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const userMessage = context.messages.find((m) => m.senderRole === 'user');
    expect(userMessage).toBeDefined();

    // Should have two enriched attached tasks
    expect(userMessage!.attachedTasks).toBeDefined();
    expect(userMessage!.attachedTasks?.length).toBe(2);

    // Verify both tasks have content
    expect(userMessage!.attachedTasks?.[0].content).toContain('Task 1: Fix login bug');
    expect(userMessage!.attachedTasks?.[1].content).toContain('Task 2: Update documentation');
  });
});
