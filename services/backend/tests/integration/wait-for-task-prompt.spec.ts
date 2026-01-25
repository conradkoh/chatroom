/**
 * Wait-for-Task Prompt Integration Tests
 *
 * Tests the complete message sent from server to wait-for-task command,
 * including all sections: init prompt, task info, pinned message, backlog attachments, and available actions.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

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

describe('Wait-for-Task Full Prompt', () => {
  test('materializes complete wait-for-task message with backlog attachment', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-wait-for-task-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog task
    const backlogResult = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content:
        'Fix: Agent lacks knowledge of backlog listing\n\nAdd backlog section to wait-for-task',
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
        'Can we add a backlog section to the available actions? Keep it concise and follow current format.',
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

    // Get the init prompt (shown when wait-for-task first starts)
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Get the task delivery prompt (shown when task is delivered)
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      messageId: userMessageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // ===== VERIFY INIT PROMPT =====
    expect(initPrompt).toBeDefined();
    expect(initPrompt?.prompt).toBeDefined();

    // Should have role header
    expect(initPrompt?.prompt).toContain('# Pair Team');
    expect(initPrompt?.prompt).toContain('## Your Role: BUILDER');

    // Should have Getting Started section (not Available Actions)
    expect(initPrompt?.prompt).toContain('## Getting Started');
    expect(initPrompt?.prompt).toContain('### Read Context');
    expect(initPrompt?.prompt).toContain('### Wait for Tasks');

    // Should have classification section
    expect(initPrompt?.prompt).toContain('### Classify Task');
    expect(initPrompt?.prompt).toContain('#### Question');
    expect(initPrompt?.prompt).toContain('#### Follow Up');
    expect(initPrompt?.prompt).toContain('#### New Feature');

    // Should have builder workflow instructions
    expect(initPrompt?.prompt).toContain('## Builder Workflow');

    // Should include commands section
    expect(initPrompt?.prompt).toContain('### Commands');
    expect(initPrompt?.prompt).toContain('**Complete task and hand off:**');

    // ===== VERIFY TASK DELIVERY PROMPT =====
    expect(taskDeliveryPrompt).toBeDefined();
    expect(taskDeliveryPrompt.humanReadable).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY HUMAN READABLE FORMAT =====
    const humanPrompt = taskDeliveryPrompt.humanReadable;

    // Should have available actions section
    expect(humanPrompt).toContain('## Available Actions');
    expect(humanPrompt).toContain('### Gain Context');
    expect(humanPrompt).toContain('### List Messages');
    expect(humanPrompt).toContain('### View Code Changes');
    expect(humanPrompt).toContain('### Complete Task');
    expect(humanPrompt).toContain('### Backlog');

    // Should have backlog section with commands
    expect(humanPrompt).toContain('The chatroom has a task backlog');
    expect(humanPrompt).toContain(`chatroom backlog list ${chatroomId}`);
    expect(humanPrompt).toContain('chatroom backlog --help');

    // Should have role prompt
    expect(humanPrompt).toContain('## Your Role: BUILDER');
    expect(humanPrompt).toContain('## Builder Workflow');

    // Should have wait-for-task reminder
    expect(humanPrompt).toContain('wait-for-task');
    expect(humanPrompt).toContain(chatroomId);
    expect(humanPrompt).toContain('--role=builder');

    // Should have environment variable prefix
    expect(humanPrompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // ===== VERIFY JSON CONTEXT =====
    const jsonContext = taskDeliveryPrompt.json;

    // Should have task information
    expect(jsonContext.task).toBeDefined();
    expect(jsonContext.task._id).toBe(startResult.taskId);
    expect(jsonContext.task.status).toBe('in_progress');

    // Should have message information
    expect(jsonContext.message).toBeDefined();
    expect(jsonContext.message?._id).toBe(userMessageId);
    expect(jsonContext.message?.senderRole).toBe('user');
    expect(jsonContext.message?.content).toContain('backlog section');

    // Should have context window
    expect(jsonContext.contextWindow).toBeDefined();
    expect(jsonContext.contextWindow.originMessage).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.content).toContain('backlog section');

    // Should have attached backlog task in context
    expect(jsonContext.contextWindow.originMessage?.attachedTaskIds).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.attachedTaskIds?.length).toBeGreaterThan(0);
    expect(jsonContext.contextWindow.originMessage?.attachedTasks).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.attachedTasks?.length).toBeGreaterThan(0);

    // Verify backlog task details
    const attachedTask = jsonContext.contextWindow.originMessage?.attachedTasks?.[0];
    expect(attachedTask).toBeDefined();
    expect(attachedTask?.content).toContain('Fix: Agent lacks knowledge');
    expect(attachedTask?.status).toBe('backlog_acknowledged');

    // Should have role prompt context
    expect(jsonContext.rolePrompt).toBeDefined();
    expect(jsonContext.rolePrompt.prompt).toBeDefined();
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('reviewer');

    // Should have chatroom metadata
    expect(jsonContext.chatroomId).toBe(chatroomId);
    expect(jsonContext.role).toBe('builder');
    expect(jsonContext.teamName).toBe('Pair Team');
    expect(jsonContext.teamRoles).toContain('builder');
    expect(jsonContext.teamRoles).toContain('reviewer');
  });

  test('formats task info section correctly for CLI display', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-task-info-format');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends simple message
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Fix the dark mode toggle',
      type: 'message',
    });

    // Builder claims and starts
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

    // Get task delivery prompt
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      messageId: userMessageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Verify JSON contains all necessary info for CLI to format task info section
    const jsonContext = taskDeliveryPrompt.json;

    // CLI needs task ID to show in TASK INFORMATION section
    expect(jsonContext.task._id).toBeDefined();
    expect(typeof jsonContext.task._id).toBe('string');

    // CLI needs message ID if present
    expect(jsonContext.message?._id).toBeDefined();

    // CLI needs origin message for PINNED section
    expect(jsonContext.contextWindow.originMessage).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.content).toBe('Fix the dark mode toggle');
    expect(jsonContext.contextWindow.originMessage?.senderRole).toBe('user');

    // Verify classification is accessible (even if null for new message)
    expect(jsonContext.contextWindow.classification).toBeDefined();
  });

  test('includes classification info for task-started command', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-classification-info');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Add user authentication',
      type: 'message',
    });

    // Builder claims and starts
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

    // Get task delivery prompt
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Role prompt should include current classification info
    expect(taskDeliveryPrompt.json.rolePrompt.currentClassification).toBeNull(); // New message, not yet classified

    // After classification, it should be available
    await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'new_feature',
      featureTitle: 'User Authentication',
      featureDescription: 'Add login/logout functionality',
      featureTechSpecs: 'Use JWT tokens, bcrypt for passwords',
    });

    // Get updated prompt
    const updatedPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Should now have classification
    expect(updatedPrompt.json.rolePrompt.currentClassification).toBe('new_feature');
  });
});
