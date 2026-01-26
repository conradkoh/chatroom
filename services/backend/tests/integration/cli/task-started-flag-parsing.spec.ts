/**
 * Task-Started CLI Flag Parsing Tests
 *
 * Tests specifically for the --no-classify flag to ensure Commander.js
 * flag parsing is handled correctly.
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

describe('task-started --no-classify flag', () => {
  test('entry point role can classify with --origin-message-classification', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-classify-entry');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'How does authentication work?',
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

    // Builder classifies as question (entry point role)
    const result = await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'question',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(result.success).toBe(true);
    expect(result.classification).toBe('question');
  }, 10000);

  test('handoff recipient can use skipClassification (simulates --no-classify)', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-no-classify-handoff');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Add dark mode toggle',
      type: 'message',
    });

    // Builder claims, starts, and classifies
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const builderTaskResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: builderTaskResult.taskId,
      originMessageClassification: 'new_feature',
      rawStdin: `---TITLE---
Dark Mode
---DESCRIPTION---
Add dark mode toggle
---TECH_SPECS---
Use CSS variables`,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Builder hands off to reviewer
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Implemented dark mode',
      targetRole: 'reviewer',
    });

    // Reviewer claims and starts the handoff task
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    const reviewerTaskResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    // Reviewer acknowledges without classifying (simulates --no-classify flag)
    // This is the critical test: skipClassification should work
    const result = await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      taskId: reviewerTaskResult.taskId,
      skipClassification: true, // This simulates what happens when --no-classify is used
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Should succeed and return the existing classification from the original user message
    expect(result.success).toBe(true);
    expect(result.classification).toBe('new_feature');
  }, 10000);

  test('error when neither classification nor skipClassification provided', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-missing-both');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Test message',
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

    // Try to acknowledge without classification or skipClassification flag
    await expect(
      t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        // Missing both originMessageClassification and skipClassification
        convexUrl: 'http://127.0.0.1:3210',
      })
    ).rejects.toThrow();
  });

  test('error when both classification and skipClassification provided', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-both-provided');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Test message',
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

    // Try to provide both classification and skipClassification
    await expect(
      t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
        skipClassification: true, // Can't have both!
        convexUrl: 'http://127.0.0.1:3210',
      })
    ).rejects.toThrow();
  });
});
