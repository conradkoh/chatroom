/**
 * Team Pair Workflow Integration Tests
 *
 * Comprehensive tests that simulate the entire flow for the Pair team (builder + reviewer).
 * Uses inline snapshots for prompt verification to make changes visible during code review.
 *
 * Following WET (Write Everything Twice) principles - prompts are inlined rather than
 * referenced from variables to make the expected output immediately visible.
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
    teamName: 'Pair',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
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

describe('Pair Team Workflow', () => {
  describe('new_feature classification flow', () => {
    test('user → builder → reviewer → user: full new_feature workflow', async () => {
      // ========================================
      // SETUP: Create session, chatroom, and participants
      // ========================================
      const { sessionId } = await createTestSession('test-new-feature-flow');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // ========================================
      // STEP 1: User sends a message (automatically routed to builder)
      // ========================================
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a new login page with OAuth support',
        type: 'message',
      });
      expect(userMessageId).toBeDefined();

      // Verify a pending task was created for builder
      const builderPendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(builderPendingTasks).toHaveLength(1);
      expect(builderPendingTasks[0].task.status).toBe('pending');

      // ========================================
      // STEP 2: Builder starts task and classifies as new_feature
      // ========================================
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'new_feature',
      });

      // ========================================
      // STEP 3: Verify builder's prompt shows restriction
      // ========================================
      const builderPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Verify classification context
      expect(builderPrompt.currentClassification).toBe('new_feature');
      expect(builderPrompt.canHandoffToUser).toBe(false);
      expect(builderPrompt.restrictionReason).toBe(
        'new_feature requests must be reviewed before returning to user'
      );

      // Snapshot the full prompt for review
      // WET: Full prompt is inline for visibility during code review
      expect(builderPrompt.prompt).toMatchInlineSnapshot(`
        "## Your Role: BUILDER

        You are the implementer responsible for writing code and building solutions.

        ### Workflow

        1. Receive task (from user or reviewer handoff)
        2. Implement the requested changes
        3. Commit your work with clear messages
        4. Hand off to reviewer with a summary

        ### Current Task: NEW FEATURE
        New functionality request. MUST go through reviewer before returning to user.

        ### Handoff Options
        Available targets: reviewer

        ⚠️ **Restriction:** new_feature requests must be reviewed before returning to user

        ### Commands

        **Complete task and hand off:**
        \`\`\`
        # Write message to file first:
        # mkdir -p tmp/chatroom && echo "<summary>" > tmp/chatroom/message.md
        chatroom handoff 10002;chatroom_rooms \\
          --role=builder \\
          --message-file="tmp/chatroom/message.md" \\
          --next-role=<target>
        \`\`\`

        **Always run after handoff:**
        \`\`\`
        chatroom wait-for-task 10002;chatroom_rooms --role=builder --session=1
        \`\`\`

        **⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), immediately restart it!**"
      `);

      // ========================================
      // STEP 4: Builder tries to hand off directly to user - SHOULD FAIL
      // ========================================
      const failedHandoff = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with the login page!',
        targetRole: 'user',
      });
      expect(failedHandoff.success).toBe(false);
      expect(failedHandoff.error).toBeDefined();
      expect(failedHandoff.error?.message).toContain(
        'Cannot hand off directly to user. new_feature requests must be reviewed before returning to user.'
      );
      expect(failedHandoff.error?.suggestedTarget).toBe('reviewer');

      // ========================================
      // STEP 5: Builder hands off to reviewer (allowed)
      // ========================================
      const builderHandoffResult = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Implemented login page with OAuth support. Added Google and GitHub providers.',
        targetRole: 'reviewer',
      });
      expect(builderHandoffResult.messageId).toBeDefined();
      expect(builderHandoffResult.newTaskId).toBeDefined();

      // ========================================
      // STEP 6: Reviewer receives pending task
      // ========================================
      const reviewerPendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });
      expect(reviewerPendingTasks).toHaveLength(1);
      expect(reviewerPendingTasks[0].task.status).toBe('pending');

      // Start the task as reviewer
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      // ========================================
      // STEP 7: Verify reviewer's prompt allows user handoff
      // ========================================
      const reviewerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      expect(reviewerPrompt.currentClassification).toBe('new_feature');
      expect(reviewerPrompt.canHandoffToUser).toBe(true);
      expect(reviewerPrompt.restrictionReason).toBeNull();

      // Snapshot reviewer's prompt
      // WET: Full prompt inline for visibility
      expect(reviewerPrompt.prompt).toMatchInlineSnapshot(`
        "## Your Role: REVIEWER

        You are the quality guardian responsible for reviewing and validating code changes.

        ### Workflow

        **Important: Do NOT run task-started** - the task is already classified by the builder.

        **Phase 1: Understand the Request**
        First, read the ORIGINAL user request below to understand what should have been built.

        **Phase 2: Run Verification Commands**
        \`\`\`bash
        pnpm typecheck    # Check for TypeScript errors
        pnpm lint:fix     # Check for linting issues
        git status        # View uncommitted changes
        git diff          # View detailed changes
        git log --oneline -5  # View recent commits
        \`\`\`

        **Phase 3: Review Against Checklist**
        - [ ] TypeScript: No errors, no \`any\` types, proper typing
        - [ ] Code quality: No hacks/shortcuts, proper patterns
        - [ ] Requirements: ALL original requirements addressed
        - [ ] Guidelines: Follows codebase conventions (check AGENTS.md, etc.)
        - [ ] Design: Uses design system (semantic colors, existing components)
        - [ ] Security: No obvious vulnerabilities

        **Phase 4: Decision**
        - **Changes needed** → Provide specific feedback, hand to builder
        - **Approved** → Confirm requirements met, hand to user

        ### Multi-Phase Review

        For complex reviews, you can break the review into phases:

        1. **Phase 1**: TypeScript and linting verification
        2. **Phase 2**: Code quality and patterns review
        3. **Phase 3**: Requirements and design compliance

        To continue to the next phase, hand off to yourself:
        \`\`\`bash
        # Write message to file with unique ID first
        mkdir -p tmp/chatroom
        MSG_FILE="tmp/chatroom/message-$(date +%s%N).md"
        echo "Phase 1 complete: <findings>. Continuing to Phase 2." > "$MSG_FILE"

        chatroom handoff 10002;chatroom_rooms --role=reviewer --message-file="$MSG_FILE" --next-role=reviewer
        \`\`\`

        ### Current Task: NEW FEATURE
        New functionality request. MUST go through reviewer before returning to user.

        ### Handoff Options
        Available targets: builder, user

        ### Commands

        **Complete task and hand off:**
        \`\`\`
        # Write message to file first:
        # mkdir -p tmp/chatroom && echo "<summary>" > tmp/chatroom/message.md
        chatroom handoff 10002;chatroom_rooms \\
          --role=reviewer \\
          --message-file="tmp/chatroom/message.md" \\
          --next-role=<target>
        \`\`\`

        **Always run after handoff:**
        \`\`\`
        chatroom wait-for-task 10002;chatroom_rooms --role=reviewer --session=1
        \`\`\`

        **⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), immediately restart it!**"
      `);

      // ========================================
      // STEP 8: Reviewer approves and hands off to user
      // ========================================
      const reviewerHandoffResult = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'LGTM! Code is clean, tests pass, and OAuth providers are correctly configured.',
        targetRole: 'user',
      });
      expect(reviewerHandoffResult.messageId).toBeDefined();
      expect(reviewerHandoffResult.newTaskId).toBeNull(); // No task created for user handoff

      // ========================================
      // VERIFY FINAL STATE
      // ========================================
      const allMessages = await t.query(api.messages.list, {
        sessionId,
        chatroomId,
      });

      // Filter to only message/handoff types (excluding join messages)
      const contentMessages = allMessages.filter(
        (m) => m.type === 'message' || m.type === 'handoff'
      );

      // Should have 3 content messages: user message + builder handoff + reviewer handoff
      expect(contentMessages).toHaveLength(3);
      expect(contentMessages[0].senderRole).toBe('user');
      expect(contentMessages[0].type).toBe('message');
      expect(contentMessages[1].senderRole).toBe('builder');
      expect(contentMessages[1].type).toBe('handoff');
      expect(contentMessages[1].targetRole).toBe('reviewer');
      expect(contentMessages[2].senderRole).toBe('reviewer');
      expect(contentMessages[2].type).toBe('handoff');
      expect(contentMessages[2].targetRole).toBe('user');
    });

    test('builder prompt includes classification instructions when no classification yet', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-classification-prompt');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends a message
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the status of the project?',
        type: 'message',
      });

      // Start the task but DON'T classify yet
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Get builder prompt BEFORE classification
      const builderPromptBeforeClassification = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Should show classification instructions since no classification yet
      expect(builderPromptBeforeClassification.currentClassification).toBeNull();

      // Prompt should include classification instructions
      // WET: Checking for specific text in the prompt
      expect(builderPromptBeforeClassification.prompt).toContain(
        'IMPORTANT: Classify the task first!'
      );
      expect(builderPromptBeforeClassification.prompt).toContain(
        '--classification=<question|new_feature|follow_up>'
      );
    });
  });

  describe('question classification flow', () => {
    test('user → builder → user: direct response for questions', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-question-flow');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User asks a question
      const userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the current test coverage percentage?',
        type: 'message',
      });

      // Builder starts task
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Builder classifies as question
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMessageId,
        classification: 'question',
      });

      // Verify builder CAN hand off directly to user for questions
      const builderPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(builderPrompt.currentClassification).toBe('question');
      expect(builderPrompt.canHandoffToUser).toBe(true);
      expect(builderPrompt.restrictionReason).toBeNull();

      // Snapshot the question prompt
      expect(builderPrompt.prompt).toMatchInlineSnapshot(`
        "## Your Role: BUILDER

        You are the implementer responsible for writing code and building solutions.

        ### Workflow

        1. Receive task (from user or reviewer handoff)
        2. Implement the requested changes
        3. Commit your work with clear messages
        4. Hand off to reviewer with a summary

        ### Current Task: QUESTION
        User is asking a question. Can respond directly after answering.

        ### Handoff Options
        Available targets: reviewer, user

        ### Commands

        **Complete task and hand off:**
        \`\`\`
        # Write message to file first:
        # mkdir -p tmp/chatroom && echo "<summary>" > tmp/chatroom/message.md
        chatroom handoff 10023;chatroom_rooms \\
          --role=builder \\
          --message-file="tmp/chatroom/message.md" \\
          --next-role=<target>
        \`\`\`

        **Always run after handoff:**
        \`\`\`
        chatroom wait-for-task 10023;chatroom_rooms --role=builder --session=1
        \`\`\`

        **⚠️ If wait-for-task is killed unexpectedly (SIGTERM, timeout, etc.), immediately restart it!**"
      `);

      // Builder hands off directly to user (should succeed)
      const handoffResult = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'The current test coverage is 87.3% as of the last CI run.',
        targetRole: 'user',
      });
      expect(handoffResult.messageId).toBeDefined();
      expect(handoffResult.newTaskId).toBeNull();
    });
  });

  describe('follow_up classification flow', () => {
    test('follow_up inherits rules from original message', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-follow-up-flow');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends initial new_feature request
      const originalMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add user profile page',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: originalMessageId,
        classification: 'new_feature',
      });

      // Builder completes and hands off to reviewer
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Implemented profile page with avatar upload',
        targetRole: 'reviewer',
      });

      // Reviewer approves
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'LGTM!',
        targetRole: 'user',
      });

      // User sends a follow-up message
      const followUpMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Can you also add email verification?',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Builder classifies as follow_up
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: followUpMessageId,
        classification: 'follow_up',
      });

      // Verify builder prompt shows follow-up context
      const builderPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(builderPrompt.currentClassification).toBe('follow_up');
      expect(builderPrompt.prompt).toContain('### Current Task: FOLLOW-UP');
      expect(builderPrompt.prompt).toContain('Same rules as the original apply');
    });
  });

  describe('context window', () => {
    test('context window includes all messages from origin', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-context-window');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends initial message
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Implement feature X',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'new_feature',
      });

      // Builder hands off
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with feature X',
        targetRole: 'reviewer',
      });

      // Get context window
      const contextWindow = await t.query(api.messages.getContextWindow, {
        sessionId,
        chatroomId,
      });

      // Origin should be the user's message
      expect(contextWindow.originMessage).toBeDefined();
      expect(contextWindow.originMessage!.content).toBe('Implement feature X');
      expect(contextWindow.originMessage!.senderRole).toBe('user');

      // Context should include origin + all subsequent messages
      expect(contextWindow.contextMessages).toHaveLength(2);
      expect(contextWindow.contextMessages[0].content).toBe('Implement feature X');
      expect(contextWindow.contextMessages[1].content).toBe('Done with feature X');

      // Classification should come from origin
      expect(contextWindow.classification).toBe('new_feature');
    });
  });

  describe('reviewer workflow', () => {
    test('reviewer can request changes and builder receives handoff', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reviewer-changes');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends message, builder handles it
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add dark mode support',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'new_feature',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Added dark mode toggle',
        targetRole: 'reviewer',
      });

      // Reviewer starts review
      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      // Reviewer requests changes (hands back to builder)
      const changeRequestResult = await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'Please add system preference detection for dark mode',
        targetRole: 'builder',
      });

      expect(changeRequestResult.messageId).toBeDefined();
      expect(changeRequestResult.newTaskId).toBeDefined(); // Task created for builder

      // Builder should have a new pending task
      const builderTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(builderTasks).toHaveLength(1);
      expect(builderTasks[0].message!.content).toBe(
        'Please add system preference detection for dark mode'
      );
    });

    test('reviewer prompt does not include classification instructions', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reviewer-no-classify');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Complete flow to get to reviewer
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'new_feature',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done',
        targetRole: 'reviewer',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      // Get reviewer prompt
      const reviewerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      // Reviewer should NOT have classification instructions
      expect(reviewerPrompt.prompt).toContain('Do NOT run task-started');
      expect(reviewerPrompt.prompt).not.toContain('Classify the task first');
    });
  });

  describe('task-started reminders', () => {
    test('taskStarted returns focused reminder for builder + new_feature', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reminder-new-feature');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends message
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a new dashboard',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Classify as new_feature and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'new_feature',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('new_feature');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('hand off to reviewer');
      expect(result.reminder).toContain('--next-role=reviewer');
    });

    test('taskStarted returns focused reminder for builder + question', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reminder-question');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User asks a question
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the current status?',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Classify as question and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'question',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('question');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('directly to the user');
      // Should NOT mention reviewer for questions
      expect(result.reminder).not.toContain('reviewer');
    });

    test('taskStarted returns focused reminder for builder + follow_up', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reminder-follow-up');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends message
      const userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Also add search functionality',
        type: 'message',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Classify as follow_up and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        messageId: userMsgId,
        classification: 'follow_up',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('follow_up');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('Continue');
      expect(result.reminder).toContain('original task');
    });
  });
});
