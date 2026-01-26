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
      const _userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a new login page with OAuth support',
        type: 'message',
      });
      expect(_userMessageId).toBeDefined();

      // Verify a pending task was created for builder
      const builderPendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(builderPendingTasks).toHaveLength(1);
      expect(builderPendingTasks[0].task.status).toBe('pending');

      // ========================================
      // STEP 2: Builder claims, starts task and classifies as new_feature
      // ========================================
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
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
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


         ## Builder Workflow
         
         You are the implementer responsible for writing code and building solutions.
         
         **Pair Team Context:**
         - You work with a reviewer who will check your code
         - Focus on implementation, let reviewer handle quality checks
         - Hand off to reviewer for all code changes
         
         
        ## Builder Workflow

        You are responsible for implementing code changes based on requirements.

        **Classification (Entry Point Role):**
        As the entry point, you receive user messages directly. When you receive a user message:
        1. First run \`chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
        2. Then do your work
        3. Hand off to reviewer for code changes, or directly to user for questions

        **Typical Flow:**
        1. Receive task (from user or handoff from reviewer)
        2. Implement the requested changes
        3. Commit your work with clear messages
        4. Hand off to reviewer with a summary of what you built

        **Handoff Rules:**
        - **After code changes** → Hand off to \`reviewer\`
        - **For simple questions** → Can hand off directly to \`user\`
        - **For \`new_feature\` classification** → MUST hand off to \`reviewer\` (cannot skip review)

        **When you receive handoffs from the reviewer:**
        You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.

        **Development Best Practices:**
        - Write clean, maintainable code
        - Add appropriate tests when applicable
        - Document complex logic
        - Follow existing code patterns and conventions
        - Consider edge cases and error handling

        **Git Workflow:**
        - Use descriptive commit messages
        - Create logical commits (one feature/change per commit)
        - Keep the working directory clean between commits
        - Use \`git status\`, \`git diff\` to review changes before committing

         
         **Pair Team Handoff Rules:**
         - **After code changes** → Hand off to reviewer
         - **For simple questions** → Can hand off directly to user
         - **For new_feature classification** → MUST hand off to reviewer (cannot skip review)
         
         

        ### Current Task: NEW FEATURE
        New functionality request. MUST go through reviewer before returning to user.

        ### Handoff Options
        Available targets: reviewer

        ⚠️ **Restriction:** new_feature requests must be reviewed before returning to user

        ### Commands

        **Complete task and hand off:**

        \`\`\`bash
        chatroom handoff --chatroom-id=10002;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
        [Your message here]
        EOF
        \`\`\`

        Replace \`[Your message here]\` with:
        - **Summary**: Brief description of what was done
        - **Changes Made**: Key changes (bullets)
        - **Testing**: How to verify the work

        **Report progress on current task:**

        \`\`\`bash
        chatroom report-progress --chatroom-id=10002;chatroom_rooms --role=builder << 'EOF'
        [Your progress message here]
        EOF
        \`\`\`

        Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

        **Continue receiving messages after \`handoff\`:**
        \`\`\`
        chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
        \`\`\`

        Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you"
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


         ## Reviewer Workflow
         
         You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
         
         **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
         
         **Pair Team Context:**
         - You work with a builder who implements code
         - Focus on code quality and requirements
         - Provide constructive feedback to builder
         
         
        ## Reviewer Workflow

        You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it and classify what type of request it is:

        **Important: DO run task-started** - Every message you receive needs to be classified, even handoffs.

        **Typical Flow:**
        1. Receive message (handoff from builder or other agent)
        2. First run \`chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message
        3. Review the code changes or content:
           - Check uncommitted changes: \`git status\`, \`git diff\`
           - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
        4. Either approve or request changes

        **Your Options After Review:**

        **If changes are needed:**
        \`\`\`bash
        chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=builder << 'EOF'
        [Your message here]
        EOF
        \`\`\`

        Replace \`[Your message here]\` with your detailed feedback:
        - **Issues Found**: List specific problems
        - **Suggestions**: Provide actionable recommendations

        **If work is approved:**
        \`\`\`bash
        chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=user << 'EOF'
        [Your message here]
        EOF
        \`\`\`

        Replace \`[Your message here]\` with:
        - **APPROVED ✅**: Clear approval statement
        - **Summary**: What was reviewed and verified

        **Review Checklist:**
        - [ ] Code correctness and functionality
        - [ ] Error handling and edge cases
        - [ ] Code style and best practices
        - [ ] Documentation and comments
        - [ ] Tests (if applicable)
        - [ ] Security considerations
        - [ ] Performance implications

        **Review Process:**
        1. **Understand the requirements**: Review the original task and expected outcome
        2. **Check implementation**: Verify the code meets the requirements
        3. **Test the changes**: If possible, test the implementation
        4. **Provide feedback**: Be specific and constructive in feedback
        5. **Track iterations**: Keep track of review rounds

        **Important:** For multi-round reviews, keep handing back to builder until all issues are resolved.

        **Communication Style:**
        - Be specific about what needs to be changed
        - Explain why changes are needed
        - Suggest solutions when possible
        - Maintain a collaborative and constructive tone

         
         
        ## Available Review Policies

        These policies should be applied when reviewing code to ensure high quality:

        ### 1. Security Policy
        **Focus:** Authentication, authorization, input validation, data handling, and API security.

        **Key Areas:**
        - Authentication & authorization checks
        - Input validation and sanitization (SQL injection, XSS, path traversal)
        - Secrets management and PII handling
        - API security (rate limiting, CORS, error messages)
        - Common vulnerabilities (injection attacks, broken access control, cryptographic issues)

        ### 2. Design Policy
        **Focus:** Design system compliance, UI/UX patterns, accessibility, and consistency.

        **Key Areas:**
        - Design system compliance (tokens, component patterns, reusability)
        - Color usage (semantic colors, dark mode support)
        - Component patterns (structure, TypeScript props, accessibility, responsive design)
        - Typography and spacing following design system
        - UX considerations (loading states, error states, interactive feedback)

        ### 3. Performance Policy
        **Focus:** Frontend and backend optimization, efficient resource usage.

        **Key Areas:**
        - Frontend: React optimization (useMemo, useCallback, React.memo), bundle size, rendering
        - Backend: Database queries (indexes, N+1 patterns), API design, memory management
        - Platform-specific: Next.js (Server/Client Components), Convex (query indexing), Core Web Vitals
        - Scalability considerations

        **Note:** Apply these policies based on the type of changes being reviewed. Not all policies may be relevant for every review.

         
         **Pair Team Handoff Rules:**
         - If the user's goal is met → hand off to user
         - If changes are needed → hand off to builder with specific feedback
         
         

        ### Current Task: NEW FEATURE
        New functionality request. MUST go through reviewer before returning to user.

        ### Handoff Options
        Available targets: builder, user

        ### Commands

        **Complete task and hand off:**

        \`\`\`bash
        chatroom handoff --chatroom-id=10002;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
        [Your message here]
        EOF
        \`\`\`

        Replace \`[Your message here]\` with:
        - **Summary**: Brief description of what was done
        - **Changes Made**: Key changes (bullets)
        - **Testing**: How to verify the work

        **Report progress on current task:**

        \`\`\`bash
        chatroom report-progress --chatroom-id=10002;chatroom_rooms --role=reviewer << 'EOF'
        [Your progress message here]
        EOF
        \`\`\`

        Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

        **Continue receiving messages after \`handoff\`:**
        \`\`\`
        chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=reviewer
        \`\`\`

        Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you"
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

      // Claim and start the task but DON'T classify yet
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

      // Get builder prompt BEFORE classification
      const builderPromptBeforeClassification = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Should show classification instructions since no classification yet
      expect(builderPromptBeforeClassification.currentClassification).toBeNull();

      // Prompt should include general classification instructions for entry point roles
      expect(builderPromptBeforeClassification.prompt).toContain(
        'Classification (Entry Point Role)'
      );
      expect(builderPromptBeforeClassification.prompt).toContain('task-started');
    });
  });

  describe('question classification flow', () => {
    test('user → builder → user: direct response for questions', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-question-flow');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User asks a question
      // @ts-expect-error unused but needed for test flow
      const _userMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the current test coverage percentage?',
        type: 'message',
      });

      // Builder claims and starts task
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

      // Builder classifies as question
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
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


         ## Builder Workflow
         
         You are the implementer responsible for writing code and building solutions.
         
         **Pair Team Context:**
         - You work with a reviewer who will check your code
         - Focus on implementation, let reviewer handle quality checks
         - Hand off to reviewer for all code changes
         
         
        ## Builder Workflow

        You are responsible for implementing code changes based on requirements.

        **Classification (Entry Point Role):**
        As the entry point, you receive user messages directly. When you receive a user message:
        1. First run \`chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
        2. Then do your work
        3. Hand off to reviewer for code changes, or directly to user for questions

        **Typical Flow:**
        1. Receive task (from user or handoff from reviewer)
        2. Implement the requested changes
        3. Commit your work with clear messages
        4. Hand off to reviewer with a summary of what you built

        **Handoff Rules:**
        - **After code changes** → Hand off to \`reviewer\`
        - **For simple questions** → Can hand off directly to \`user\`
        - **For \`new_feature\` classification** → MUST hand off to \`reviewer\` (cannot skip review)

        **When you receive handoffs from the reviewer:**
        You will receive feedback on your code. Review the feedback, make the requested changes, and hand back to the reviewer.

        **Development Best Practices:**
        - Write clean, maintainable code
        - Add appropriate tests when applicable
        - Document complex logic
        - Follow existing code patterns and conventions
        - Consider edge cases and error handling

        **Git Workflow:**
        - Use descriptive commit messages
        - Create logical commits (one feature/change per commit)
        - Keep the working directory clean between commits
        - Use \`git status\`, \`git diff\` to review changes before committing

         
         **Pair Team Handoff Rules:**
         - **After code changes** → Hand off to reviewer
         - **For simple questions** → Can hand off directly to user
         - **For new_feature classification** → MUST hand off to reviewer (cannot skip review)
         
         

        ### Current Task: QUESTION
        User is asking a question. Can respond directly after answering.

        ### Handoff Options
        Available targets: reviewer, user

        ### Commands

        **Complete task and hand off:**

        \`\`\`bash
        chatroom handoff --chatroom-id=10023;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
        [Your message here]
        EOF
        \`\`\`

        Replace \`[Your message here]\` with:
        - **Summary**: Brief description of what was done
        - **Changes Made**: Key changes (bullets)
        - **Testing**: How to verify the work

        **Report progress on current task:**

        \`\`\`bash
        chatroom report-progress --chatroom-id=10023;chatroom_rooms --role=builder << 'EOF'
        [Your progress message here]
        EOF
        \`\`\`

        Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

        **Continue receiving messages after \`handoff\`:**
        \`\`\`
        chatroom wait-for-task --chatroom-id=10023;chatroom_rooms --role=builder
        \`\`\`

        Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you"
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
      // @ts-expect-error unused but needed for test flow
      const _originalMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add user profile page',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      const startResult1 = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult1.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
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

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'reviewer',
        content: 'LGTM!',
        targetRole: 'user',
      });

      // User sends a follow-up message
      // @ts-expect-error unused but needed for test flow
      const _followUpMessageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Can you also add email verification?',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      const startResult2 = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Builder classifies as follow_up
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult2.taskId,
        originMessageClassification: 'follow_up',
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
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Implement feature X',
        type: 'message',
      });

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
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
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
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add dark mode support',
        type: 'message',
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

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: builderStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Added dark mode toggle',
        targetRole: 'reviewer',
      });

      // Reviewer starts review
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
      expect(builderTasks[0].task.content).toBe(
        'Please add system preference detection for dark mode'
      );
    });

    test('reviewer prompt does not include classification instructions', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reviewer-no-classify');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Complete flow to get to reviewer
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add feature',
        type: 'message',
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

      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: builderStart.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done',
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

      // Get reviewer prompt
      const reviewerPrompt = await t.query(api.messages.getRolePrompt, {
        sessionId,
        chatroomId,
        role: 'reviewer',
      });

      // Reviewer should run task-started for all messages
      expect(reviewerPrompt.prompt).toContain('DO run task-started');
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
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Add a new dashboard',
        type: 'message',
      });

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

      // Classify as new_feature and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'new_feature',
        rawStdin: `---TITLE---
Test Feature
---DESCRIPTION---
Test feature description
---TECH_SPECS---
Test technical specifications`,
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
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'What is the current status?',
        type: 'message',
      });

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

      // Classify as question and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('question');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('directly to user');
      // Should NOT mention reviewer for questions
      expect(result.reminder).not.toContain('reviewer');
    });

    test('taskStarted returns focused reminder for builder + follow_up', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-reminder-follow-up');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends message
      // @ts-expect-error unused but needed for test flow
      const _userMsgId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Also add search functionality',
        type: 'message',
      });

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

      // Classify as follow_up and check reminder
      const result = await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'follow_up',
      });

      expect(result.success).toBe(true);
      expect(result.classification).toBe('follow_up');
      expect(result.reminder).toBeDefined();
      expect(result.reminder).toContain('Follow-up inherits');
      expect(result.reminder).toContain('original task');
    });
  });

  describe('wait-for-task background warnings', () => {
    test('initial prompt includes warning not to run wait-for-task in background', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-init-background-warning');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Get the initialization prompt for builder
      const initPrompt = await t.query(api.messages.getInitPrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(initPrompt.prompt).toBeDefined();

      // The init prompt includes the wait-for-task reminder from getWaitForTaskReminder()
      // which emphasizes running in foreground to stay connected
      expect(initPrompt.prompt).toContain('wait-for-task');

      // Check that it mentions running in foreground
      expect(initPrompt.prompt).toContain('foreground');

      // Check for the critical availability message
      expect(initPrompt.prompt).toContain('Message availability');
      expect(initPrompt.prompt).toContain('stay connected');
      expect(initPrompt.prompt).toContain('team cannot reach you');

      // The init prompt should warn about proper usage
      // Note: The detailed warning with & and nohup is in getWaitForTaskGuidance()
      // which is printed by the CLI, not included in the backend init prompt
      const hasProperUsageWarning =
        initPrompt.prompt.toLowerCase().includes('foreground') ||
        initPrompt.prompt.toLowerCase().includes('availability');

      expect(hasProperUsageWarning).toBe(true);
    });

    test('task delivery prompt includes reminder not to run wait-for-task in background', async () => {
      // Setup
      const { sessionId } = await createTestSession('test-task-background-warning');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // User sends a message - this automatically creates a task for builder
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Please implement feature X',
        type: 'message',
      });

      // Get the pending tasks for builder
      const pendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(pendingTasks.length).toBeGreaterThan(0);
      const taskId = pendingTasks[0].task._id;

      // Get task delivery prompt
      const taskPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId,
      });

      expect(taskPrompt.humanReadable).toBeDefined();

      // Verify the prompt contains warning about wait-for-task
      expect(taskPrompt.humanReadable).toContain('wait-for-task');

      // Check for reminder about message availability and/or backgrounding
      const hasWaitForTaskReminder =
        taskPrompt.humanReadable.includes('Message availability') ||
        taskPrompt.humanReadable.includes('stay connected') ||
        taskPrompt.humanReadable.includes('foreground') ||
        taskPrompt.humanReadable.includes('background');

      expect(hasWaitForTaskReminder).toBe(true);
    });
  });
});
