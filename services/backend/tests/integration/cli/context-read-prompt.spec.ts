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
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
    });
  }
}

describe('Context Read Command Output', () => {
  test('materializes complete context with task content and attached tasks', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-context-with-attachments');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content:
        'Bug: Missing CLI command to update status of backlog task to pending user review\n\nIn the CLI, an agent reflected that they were unable to mark a task as pending_user_review. To verify if this is true or it is a regression.',
      createdBy: 'user',
    });

    // User sends message with backlog attachment
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content:
        'can you help to find the code related to this issue? I want to change the way that "failures" are handled by the agent',
      type: 'message',
      attachedBacklogItemIds: [backlogItemId],
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

    // 2. Attached backlog items should be enriched objects (not just IDs)
    expect(userMessage!.attachedBacklogItems).toBeDefined();
    expect(Array.isArray(userMessage!.attachedBacklogItems)).toBe(true);
    expect(userMessage!.attachedBacklogItems?.length).toBe(1);

    const attachedItem = userMessage!.attachedBacklogItems?.[0];
    expect(attachedItem).toBeDefined();
    expect(attachedItem?.id).toBe(backlogItemId);
    expect(attachedItem?.content).toBeDefined();
    expect(attachedItem?.content).toContain('Bug: Missing CLI command');
    expect(attachedItem?.status).toBeDefined();
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

    // Builder claims and starts the task so it appears in context
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
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

    // Create multiple backlog items using the new chatroom_backlog API
    const item1Id = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Task 1: Fix login bug',
      createdBy: 'user',
    });

    const item2Id = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Task 2: Update documentation',
      createdBy: 'user',
    });

    // User sends message with multiple attachments
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you work on these two items?',
      type: 'message',
      attachedBacklogItemIds: [item1Id, item2Id],
    });

    // Builder claims and starts the task so it appears in context
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Get context
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const userMessage = context.messages.find((m) => m.senderRole === 'user');
    expect(userMessage).toBeDefined();

    // Should have two enriched attached backlog items
    expect(userMessage!.attachedBacklogItems).toBeDefined();
    expect(userMessage!.attachedBacklogItems?.length).toBe(2);

    // Verify both items have content
    expect(userMessage!.attachedBacklogItems?.[0].content).toContain('Task 1: Fix login bug');
    expect(userMessage!.attachedBacklogItems?.[1].content).toContain(
      'Task 2: Update documentation'
    );
  });

  test('snapshot baseline: full getContextForRole return value', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-context-snapshot-baseline');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please implement feature X',
      type: 'message',
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

    // Builder hands off to reviewer
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Implementation complete, please review',
      targetRole: 'reviewer',
    });

    // ===== GET CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Normalize dynamic values for stable snapshots
    const normalizedContext = {
      ...context,
      messages: context.messages.map((m) => ({
        ...m,
        _id: '[id]',
        _creationTime: 0,
        taskId: m.taskId ? '[taskId]' : undefined,
      })),
      originMessage: context.originMessage
        ? {
            ...context.originMessage,
            _id: '[id]',
            _creationTime: 0,
            taskId: context.originMessage.taskId ? '[taskId]' : undefined,
          }
        : null,
    };

    expect(normalizedContext).toMatchInlineSnapshot(`
      {
        "classification": "question",
        "currentContext": null,
        "messages": [
          {
            "_creationTime": 0,
            "_id": "[id]",
            "classification": "question",
            "content": "Please implement feature X",
            "senderRole": "user",
            "targetRole": "builder",
            "taskContent": "Please implement feature X",
            "taskId": "[taskId]",
            "taskStatus": "completed",
            "type": "message",
          },
        ],
        "originMessage": {
          "_creationTime": 0,
          "_id": "[id]",
          "classification": "question",
          "content": "Please implement feature X",
          "senderRole": "user",
          "taskId": "[taskId]",
          "type": "message",
        },
        "pendingTasksForRole": 0,
      }
    `);
  });

  test('includes targetRole on messages showing which role the message is assigned to', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-context-targetrole');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message (will be assigned to builder = targetRole 'builder')
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please implement feature Y',
      type: 'message',
    });

    // Builder claims, starts, and classifies task
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

    await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'question',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Builder hands off to reviewer
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Done, please review',
      targetRole: 'reviewer',
    });

    // ===== GET CONTEXT AS REVIEWER =====
    // Reviewer's task is pending/acknowledged, so the handoff message is visible once reviewer starts
    // But from builder's perspective after the handoff, the user message is visible (task=completed)
    const contextForBuilder = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // User message targetRole should be 'builder' (task assigned to builder)
    const userMessage = contextForBuilder.messages.find((m) => m.senderRole === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage!.targetRole).toBe('builder');

    // Reviewer starts the task so the handoff message becomes visible
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    const contextForReviewer = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    // The handoff message from builder should be visible and show targetRole: 'reviewer'
    const handoffMessage = contextForReviewer.messages.find((m) => m.senderRole === 'builder');
    expect(handoffMessage).toBeDefined();
    expect(handoffMessage!.targetRole).toBe('reviewer');
  });

  test('excludes messages with pending or acknowledged tasks from context', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-context-excludes-pending');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message — creates a pending task for builder
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please fix the login bug',
      type: 'message',
    });

    // Get context BEFORE claiming — message should be excluded (pending task)
    const contextBeforeClaim = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const pendingMessage = contextBeforeClaim.messages.find(
      (m) => m.content === 'Please fix the login bug'
    );
    expect(pendingMessage).toBeUndefined();

    // Builder claims the task (acknowledged status)
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Get context AFTER claiming — message should still be excluded (acknowledged task)
    const contextAfterClaim = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const acknowledgedMessage = contextAfterClaim.messages.find(
      (m) => m.content === 'Please fix the login bug'
    );
    expect(acknowledgedMessage).toBeUndefined();

    // Builder starts the task (in_progress status)
    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Get context AFTER starting — message should now be visible (in_progress task)
    const contextAfterStart = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const inProgressMessage = contextAfterStart.messages.find(
      (m) => m.content === 'Please fix the login bug'
    );
    expect(inProgressMessage).toBeDefined();
    expect(inProgressMessage!.taskStatus).toBe('in_progress');
  });
});
