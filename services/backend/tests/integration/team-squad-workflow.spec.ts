/**
 * Team Squad Workflow Integration Tests
 *
 * Comprehensive tests that simulate the entire flow for the Squad team (planner/builder/reviewer).
 * Uses inline snapshots for prompt verification to make changes visible during code review.
 *
 * Following WET (Write Everything Twice) principles - prompts are inlined rather than
 * referenced from variables to make the expected output immediately visible.
 *
 * Key differences from Pair team:
 * - Planner is the entry point (not builder)
 * - Only planner can hand off to user
 * - Builder and reviewer CANNOT hand off directly to user
 * - Dynamic team availability affects planner's workflow
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
 * Helper to create a Squad team chatroom
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
 * Helper to join participants to the chatroom with ready status
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

describe('Squad Team Workflow', () => {
  // =========================================================================
  // NEW FEATURE CLASSIFICATION FLOW
  // =========================================================================
  describe('new_feature classification flow', () => {
    test('user → planner → builder → reviewer → planner → user: full squad workflow', async () => {
      // ========================================
      // SETUP: Create session, chatroom, and participants
      // ========================================
      const { sessionId } = await createTestSession('test-squad-new-feature-flow');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // ========================================
      // STEP 1: User sends a message (automatically routed to planner as entry point)
      // ========================================
      const _userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a real-time notifications system',
        type: 'message',
      });
      expect(_userMessageId).toBeDefined();

      // Verify a pending task was created for planner (entry point)
      const plannerPendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'planner',
      });
      expect(plannerPendingTasks).toHaveLength(1);
      expect(plannerPendingTasks[0].task.status).toBe('pending');

      // ========================================
      // STEP 2: Planner claims, starts task and classifies as new_feature
      // ========================================
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStartResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStartResult.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Real-time Notifications
---DESCRIPTION---
Add WebSocket-based real-time notification system
---TECH_SPECS---
Use Convex subscriptions for real-time updates`,
      });

      // ========================================
      // STEP 3: Planner delegates to builder
      // ========================================
      const plannerToBuilderHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content:
          'Please implement the real-time notification system. Requirements: WebSocket-based, use Convex subscriptions.',
        targetRole: 'builder',
      });
      expect(plannerToBuilderHandoff.messageId).toBeDefined();
      expect(plannerToBuilderHandoff.newTaskId).toBeDefined();

      // ========================================
      // STEP 4: Builder claims and starts task
      // ========================================
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

      // ========================================
      // STEP 5: Builder hands off to reviewer
      // ========================================
      const builderToReviewerHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content:
          'Implemented notification system with Convex subscriptions. Added toast component.',
        targetRole: 'reviewer',
      });
      expect(builderToReviewerHandoff.messageId).toBeDefined();
      expect(builderToReviewerHandoff.newTaskId).toBeDefined();

      // ========================================
      // STEP 6: Reviewer claims and starts review
      // ========================================
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

      // ========================================
      // STEP 7: Reviewer approves and hands off to planner (NOT user)
      // ========================================
      const reviewerToPlannerHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'APPROVED ✅ Code looks good. Convex subscriptions properly used.',
        targetRole: 'planner',
      });
      expect(reviewerToPlannerHandoff.messageId).toBeDefined();
      expect(reviewerToPlannerHandoff.newTaskId).toBeDefined();

      // ========================================
      // STEP 8: Planner claims, reviews, and delivers to user
      // ========================================
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerToUserHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content:
          'The real-time notifications system has been implemented and reviewed. All changes approved.',
        targetRole: 'user',
      });
      expect(plannerToUserHandoff.messageId).toBeDefined();
      expect(plannerToUserHandoff.newTaskId).toBeNull(); // No task created for user handoff

      // ========================================
      // VERIFY FINAL STATE
      // ========================================
      const allMessages = await t.query(api.messages.list, {
        sessionId,
        chatroomId,
      });

      // Filter to only message/handoff types
      const contentMessages = allMessages.filter(
        (m) => m.type === 'message' || m.type === 'handoff'
      );

      // Should have 5 content messages:
      // user message + planner→builder + builder→reviewer + reviewer→planner + planner→user
      expect(contentMessages).toHaveLength(5);
      expect(contentMessages[0].senderRole).toBe('user');
      expect(contentMessages[0].type).toBe('message');
      expect(contentMessages[1].senderRole).toBe('planner');
      expect(contentMessages[1].type).toBe('handoff');
      expect(contentMessages[1].targetRole).toBe('builder');
      expect(contentMessages[2].senderRole).toBe('builder');
      expect(contentMessages[2].type).toBe('handoff');
      expect(contentMessages[2].targetRole).toBe('reviewer');
      expect(contentMessages[3].senderRole).toBe('reviewer');
      expect(contentMessages[3].type).toBe('handoff');
      expect(contentMessages[3].targetRole).toBe('planner');
      expect(contentMessages[4].senderRole).toBe('planner');
      expect(contentMessages[4].type).toBe('handoff');
      expect(contentMessages[4].targetRole).toBe('user');
    });

    test('planner prompt shows classification instructions (entry point)', async () => {
      const { sessionId } = await createTestSession('test-squad-planner-classify');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // User sends a message
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the deployment status?',
        type: 'message',
      });

      // Planner claims and starts but does NOT classify yet
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      // Get planner prompt BEFORE classification
      const plannerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      // Planner is the entry point — should have classification instructions
      expect(plannerPrompt.currentClassification).toBeNull();
      expect(plannerPrompt.prompt).toContain('Classification (Entry Point Role)');
      expect(plannerPrompt.prompt).toContain('task-started');
    });

    test('builder prompt does NOT show classification instructions (non-entry point)', async () => {
      const { sessionId } = await createTestSession('test-squad-builder-no-classify');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // User sends message → planner classifies → delegates to builder
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add search feature',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Search Feature
---DESCRIPTION---
Add search
---TECH_SPECS---
Full-text search`,
      });

      // Planner delegates to builder
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement search feature',
        targetRole: 'builder',
      });

      // Builder claims and starts
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

      // Get builder prompt
      const builderPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Builder is NOT entry point — should NOT have classification instructions
      expect(builderPrompt.prompt).not.toContain('Classification (Entry Point Role)');
      // Builder should have squad-specific context
      expect(builderPrompt.prompt).toContain('Squad Team Context');
      expect(builderPrompt.prompt).toContain('do NOT communicate directly with the user');
    });
  });

  // =========================================================================
  // QUESTION CLASSIFICATION FLOW
  // =========================================================================
  describe('question classification flow', () => {
    test('user → planner → user: planner answers questions directly', async () => {
      const { sessionId } = await createTestSession('test-squad-question-flow');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // User asks a question
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the current test coverage?',
        type: 'message',
      });

      // Planner claims and starts task
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      // Planner classifies as question
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'question',
      });

      // Verify planner CAN hand off to user for questions
      const plannerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      expect(plannerPrompt.currentClassification).toBe('question');
      expect(plannerPrompt.canHandoffToUser).toBe(true);

      // Planner answers and hands off to user
      const handoffResult = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Current test coverage is 87.3%.',
        targetRole: 'user',
      });
      expect(handoffResult.messageId).toBeDefined();
      expect(handoffResult.newTaskId).toBeNull();
    });
  });

  // =========================================================================
  // SQUAD HANDOFF RESTRICTIONS
  // =========================================================================
  describe('squad handoff restrictions', () => {
    test('builder CANNOT hand off directly to user', async () => {
      const { sessionId } = await createTestSession('test-squad-builder-no-user');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Setup: user → planner → builder flow
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature X',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Feature X
---DESCRIPTION---
Add feature X
---TECH_SPECS---
Standard implementation`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement feature X',
        targetRole: 'builder',
      });

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

      // Builder tries to hand off directly to user — SHOULD FAIL
      const failedHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature X!',
        targetRole: 'user',
      });
      expect(failedHandoff.success).toBe(false);
      expect(failedHandoff.error).toBeDefined();
      expect(failedHandoff.error?.message).toContain('Cannot hand off directly to user');
    });

    test('reviewer prompt warns against handing off directly to user (prompt-level restriction)', async () => {
      const { sessionId } = await createTestSession('test-squad-reviewer-no-user');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Setup: user → planner → builder → reviewer flow
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature Y',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Feature Y
---DESCRIPTION---
Add feature Y
---TECH_SPECS---
Standard implementation`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement feature Y',
        targetRole: 'builder',
      });

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

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature Y',
        targetRole: 'reviewer',
      });

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

      // Verify reviewer's prompt tells them NOT to hand off to user
      // Note: This is a prompt-level restriction, not a backend enforcement.
      // The squad team relies on prompt guidance to route through the planner.
      const reviewerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      expect(reviewerPrompt.prompt).toContain('Squad Team Context');
      expect(reviewerPrompt.prompt).toContain('NEVER hand off directly to');
      // The reviewer's prompt should instruct them to hand off to planner instead
      expect(reviewerPrompt.prompt).toContain('planner');
    });

    test('planner CAN hand off to user', async () => {
      const { sessionId } = await createTestSession('test-squad-planner-to-user');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Quick question',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'question',
      });

      // Planner hands off to user — SHOULD SUCCEED
      const handoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Here is the answer.',
        targetRole: 'user',
      });
      expect(handoff.success).not.toBe(false);
      expect(handoff.messageId).toBeDefined();
    });

    test('builder CAN hand off to reviewer', async () => {
      const { sessionId } = await createTestSession('test-squad-builder-to-reviewer');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Setup: user → planner → builder
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature Z',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Feature Z
---DESCRIPTION---
Add feature Z
---TECH_SPECS---
Standard implementation`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement feature Z',
        targetRole: 'builder',
      });

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

      // Builder hands off to reviewer — SHOULD SUCCEED
      const handoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature Z, please review',
        targetRole: 'reviewer',
      });
      expect(handoff.success).not.toBe(false);
      expect(handoff.messageId).toBeDefined();
      expect(handoff.newTaskId).toBeDefined();
    });

    test('reviewer CAN hand off to planner', async () => {
      const { sessionId } = await createTestSession('test-squad-reviewer-to-planner');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Setup: user → planner → builder → reviewer
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature W',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Feature W
---DESCRIPTION---
Add feature W
---TECH_SPECS---
Standard implementation`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement feature W',
        targetRole: 'builder',
      });

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

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature W',
        targetRole: 'reviewer',
      });

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

      // Reviewer hands off to planner — SHOULD SUCCEED
      const handoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'APPROVED ✅',
        targetRole: 'planner',
      });
      expect(handoff.success).not.toBe(false);
      expect(handoff.messageId).toBeDefined();
      expect(handoff.newTaskId).toBeDefined();
    });
  });

  // =========================================================================
  // TASK-STARTED REMINDERS
  // =========================================================================
  describe('task-started reminders', () => {
    test('planner + new_feature: reminder mentions delegating to builder', async () => {
      const { sessionId } = await createTestSession('test-squad-reminder-planner-nf');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a dashboard',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: startResult.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Dashboard
---DESCRIPTION---
Add dashboard
---TECH_SPECS---
React dashboard`,
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('new_feature');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('NEW FEATURE');
      expect(result.reminder).toContain('builder');
      expect(result.reminder).toContain('Decompose');
    });

    test('planner + question: reminder mentions handing off to user', async () => {
      const { sessionId } = await createTestSession('test-squad-reminder-planner-q');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What frameworks do we use?',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('question');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('QUESTION');
      expect(result.reminder).toContain('user');
    });

    test('planner + follow_up: reminder mentions follow-up rules', async () => {
      const { sessionId } = await createTestSession('test-squad-reminder-planner-fu');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Also add dark mode',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: startResult.taskId,
        originMessageClassification: 'follow_up',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('follow_up');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('FOLLOW UP');
      expect(result.reminder).toContain('follow-up');
    });

    test('builder + new_feature (squad): reminder mentions reviewer/planner, NEVER user', async () => {
      const { sessionId } = await createTestSession('test-squad-reminder-builder-nf');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Setup: user → planner → builder
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature for builder test',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Builder Test Feature
---DESCRIPTION---
Test feature
---TECH_SPECS---
Standard`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement this feature',
        targetRole: 'builder',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      const builderStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Builder uses skipClassification since it received a handoff (not a user message)
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: builderStart.taskId,
        skipClassification: true,
      });

      expect(result.success).toBe(true);
      expect(result.reminder).toBeDefined();
      // In squad, builder should hand off to reviewer, never directly to user
      expect(result.reminder).toContain('never hand off directly to user');
    });
  });

  // =========================================================================
  // DYNAMIC TEAM AVAILABILITY
  // =========================================================================
  describe('dynamic team availability', () => {
    test('planner with full team shows Full Team workflow', async () => {
      const { sessionId } = await createTestSession('test-squad-avail-full');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      });

      expect(initPrompt).toBeDefined();
      expect(initPrompt!.prompt).toContain('Full Team');
      expect(initPrompt!.prompt).toContain('builder, reviewer available');
    });

    test('planner with only builder shows Planner + Builder workflow', async () => {
      const { sessionId } = await createTestSession('test-squad-avail-builder-only');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      // Only planner and builder join
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      });

      expect(initPrompt).toBeDefined();
      expect(initPrompt!.prompt).toContain('Planner + Builder');
    });

    test('planner solo shows Planner Solo workflow', async () => {
      const { sessionId } = await createTestSession('test-squad-avail-solo');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      // Only planner joins
      await joinParticipants(sessionId, chatroomId, ['planner']);

      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      });

      expect(initPrompt).toBeDefined();
      expect(initPrompt!.prompt).toContain('Planner Solo');
      expect(initPrompt!.prompt).toContain('working solo');
    });
  });

  // =========================================================================
  // REVIEWER WORKFLOW (SQUAD)
  // =========================================================================
  describe('reviewer workflow (squad)', () => {
    test('reviewer hands off to planner on approval (not to user)', async () => {
      const { sessionId } = await createTestSession('test-squad-reviewer-approve');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Full flow: user → planner → builder → reviewer
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add notifications',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Notifications
---DESCRIPTION---
Add notifications
---TECH_SPECS---
Push notifications`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement notifications',
        targetRole: 'builder',
      });

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

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with notifications',
        targetRole: 'reviewer',
      });

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

      // Get reviewer prompt — should show squad context
      const reviewerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      expect(reviewerPrompt.prompt).toContain('Squad Team Context');
      expect(reviewerPrompt.prompt).toContain('NEVER hand off directly to');

      // Reviewer hands off to planner (correct squad flow)
      const handoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'APPROVED ✅ Notifications look good.',
        targetRole: 'planner',
      });
      expect(handoff.success).not.toBe(false);
      expect(handoff.messageId).toBeDefined();
    });

    test('reviewer hands off to builder for rework', async () => {
      const { sessionId } = await createTestSession('test-squad-reviewer-rework');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Flow: user → planner → builder → reviewer
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add auth system',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      const plannerStart = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId: plannerStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Auth System
---DESCRIPTION---
Add auth
---TECH_SPECS---
OAuth2`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'planner',
        content: 'Implement auth',
        targetRole: 'builder',
      });

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

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with auth',
        targetRole: 'reviewer',
      });

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

      // Reviewer requests rework — hands back to builder
      const reworkHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'Please add rate limiting to the auth endpoints.',
        targetRole: 'builder',
      });
      expect(reworkHandoff.success).not.toBe(false);
      expect(reworkHandoff.messageId).toBeDefined();
      expect(reworkHandoff.newTaskId).toBeDefined();

      // Builder should have a new pending task
      const builderTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(builderTasks).toHaveLength(1);
      expect(builderTasks[0].task.content).toBe('Please add rate limiting to the auth endpoints.');
    });
  });

  // =========================================================================
  // WAIT-FOR-TASK BACKGROUND WARNINGS
  // =========================================================================
  describe('wait-for-task background warnings', () => {
    test('init prompt includes warning not to run wait-for-task in background', async () => {
      const { sessionId } = await createTestSession('test-squad-init-bg-warning');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // Get the initialization prompt for planner
      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        convexUrl: 'http://127.0.0.1:3210',
      });

      expect(initPrompt!.prompt).toBeDefined();
      expect(initPrompt!.prompt).toContain('wait-for-task');
      expect(initPrompt!.prompt).toContain('foreground');
      expect(initPrompt!.prompt).toContain('Message availability');
      expect(initPrompt!.prompt).toContain('stay connected');
      expect(initPrompt!.prompt).toContain('team cannot reach you');
    });

    test('task delivery prompt includes reminder not to run wait-for-task in background', async () => {
      const { sessionId } = await createTestSession('test-squad-task-bg-warning');
      const chatroomId = await createSquadTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['planner', 'builder', 'reviewer']);

      // User sends a message
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Please implement feature X',
        type: 'message',
      });

      // Get the pending tasks for planner
      const pendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'planner',
      });

      expect(pendingTasks.length).toBeGreaterThan(0);
      const taskId = pendingTasks[0].task._id;

      // Get task delivery prompt
      const taskPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId,
      });

      expect(taskPrompt.humanReadable).toBeDefined();
      expect(taskPrompt.humanReadable).toContain('wait-for-task');

      const hasWaitForTaskReminder =
        taskPrompt.humanReadable.includes('Message availability') ||
        taskPrompt.humanReadable.includes('stay connected') ||
        taskPrompt.humanReadable.includes('foreground') ||
        taskPrompt.humanReadable.includes('background');

      expect(hasWaitForTaskReminder).toBe(true);
    });
  });
});
