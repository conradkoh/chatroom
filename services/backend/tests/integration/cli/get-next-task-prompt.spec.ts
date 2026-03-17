/**
 * Get-Next-Task Prompt Integration Tests
 *
 * Tests the complete message sent from server to get-next-task command,
 * including all sections: init prompt, task info, pinned message, backlog attachments, and available actions.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getNextTaskGuidance, getNextTaskReminder } from '../../../prompts/cli/index';
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

describe('Get-Next-Task Full Prompt', () => {
  test('materializes complete get-next-task message with backlog attachment', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-get-next-task-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content:
        'Fix: Agent lacks knowledge of backlog listing\n\nAdd backlog section to get-next-task',
      createdBy: 'user',
    });

    // User sends message with backlog attachment
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content:
        'Can we add a backlog section to the available actions? Keep it concise and follow current format.',
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

    // Get the init prompt (shown when get-next-task first starts)
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

    // ===== OUTPUT COMPLETE CLI MESSAGE FOR REVIEW =====
    // This materializes the exact message structure sent from server to get-next-task command
    // Init section (CLI-generated) + Task delivery section (backend-generated via fullCliOutput)

    const role = 'builder';

    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "${role}"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

${getNextTaskGuidance()}

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════
-->

[TIMESTAMP] 📨 Task received!

${taskDeliveryPrompt.fullCliOutput}
`;

    // Verify the complete message structure matches expected format
    // The inline snapshot will materialize the full message for human review in the test file
    expect(fullCliMessage).toMatchInlineSnapshot(`
      "
      [TIMESTAMP] ⏳ Connecting to chatroom as "builder"...
      [TIMESTAMP] ✅ Connected. Waiting for task...

      <!-- REFERENCE: Agent Initialization

      ══════════════════════════════════════════════════
      📋 AGENT INITIALIZATION PROMPT
      ══════════════════════════════════════════════════

      🔗 STAYING CONNECTED TO YOUR TEAM

      Your primary directive: Stay available to receive tasks from your team.

      Run \`get-next-task\` after completing work and handing off. This is how your team sends you the next task.

      If interrupted or restarted: finish any in-progress work, then run \`get-next-task\` to reconnect.

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      # Glossary

      - \`backlog\` (1 skill available)
          - The list of work items the team intends to do but has not yet started. Agents use the \`chatroom backlog\` CLI command group to manage backlog items.

      - \`software-engineering\` (1 skill available)
          - Universal software engineering standards: build from the application core outward, SOLID principles, and naming conventions.

      # Skills

      Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom skill list --chatroom-id=<id> --role=<role>\` to list all available skills.

      ## Getting Started

      ### Workflow Loop

      \`\`\`mermaid
      flowchart LR
          A([Start]) --> B[register-agent]
          B --> C[get-next-task
      waiting...]
          C --> D[task read
      marks in_progress]
          D --> E[Do Work]
          E --> F[handoff]
          F --> C
      \`\`\`

      ### ⚠️ CRITICAL: Read the task immediately

      When you receive a task from \`get-next-task\`, the task content is hidden. You **MUST** run \`task read\` immediately to:

      1. **Get the task content** — the full task description
      2. **Mark it as in_progress** — signals you're working on it

      Failure to run \`task read\` promptly may trigger the system to restart you.

      ### Context Recovery (after compaction/summarization)

      NOTE: If you are an agent that has undergone compaction or summarization, run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10002;chatroom_rooms" --role="builder"
      to reload your full system and role prompt. Then run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10002;chatroom_rooms" --role="builder"
      to see your current task context.

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id="10002;chatroom_rooms" --role="builder" --type=<remote|custom>
      \`\`\`

      ### Get Next Task
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10002;chatroom_rooms" --role="builder"
      \`\`\`


      ### Classify Task

      ⚠️  **RUN THIS IMMEDIATELY** after receiving a task from get-next-task.
      This marks the task as in_progress and prevents unnecessary agent restarts.

      Acknowledge and classify user messages before starting work.

      #### Question
      User is asking for information or clarification.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="<task-id>" --origin-message-classification=question
      \`\`\`

      #### Follow Up
      User is responding to previous work or providing feedback.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="<task-id>" --origin-message-classification=follow_up
      \`\`\`

      #### New Feature
      User wants new functionality. Requires title, description, and tech specs.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="<task-id>" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      [Feature title]
      ---DESCRIPTION---
      [Feature description]
      ---TECH_SPECS---
      [Technical specifications]
      EOF
      \`\`\`

      **Context Rule:** When a new commit is expected, set a new context first to keep the conversation focused. Only the entry point role can set contexts:
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="10002;chatroom_rooms" --role="builder" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF
      \`\`\`


       **Pair Team Context:**
       - You work with a reviewer who will check your code
       - Focus on implementation, let reviewer handle quality checks
       - Hand off to reviewer for all code changes
       
       
      ## Builder Workflow

      You are responsible for implementing code changes based on requirements.

      **Classification (Entry Point Role):**
      As the entry point, you receive user messages directly. When you receive a user message:
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the task content (auto-marks as in_progress)
      2. Then run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>" --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
      3. Then do your work
      4. Hand off to reviewer for code changes, or directly to user for questions

      **Typical Flow:**

      \`\`\`mermaid
      flowchart TD
          A([Start]) --> B[Receive task
      Then read it]
          B -->|from user or reviewer| C[Implement changes]
          C --> D[Commit work]
          D --> E{Classification?}
          E -->|new_feature or code changes| F[Hand off to **reviewer**]
          E -->|question| G[Hand off to **user**]
      \`\`\`

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

       

      ### Handoff Options
      Available targets: reviewer, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="10002;chatroom_rooms" --role="builder" --next-role="<target>" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id="10002;chatroom_rooms" --role="builder" << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10002;chatroom_rooms" --role="builder"
      \`\`\`

      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.

      **Reference commands:**
      - List recent messages: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id="10002;chatroom_rooms" --role="builder" --sender-role=user --limit=5 --full\`
      - Git log: \`git log --oneline -10\`

      **Recovery commands** (only needed after compaction/restart):
      - Reload system prompt: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10002;chatroom_rooms" --role="builder"\`
      - Read current task context: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10002;chatroom_rooms" --role="builder"\`

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10002;chatroom_rooms" --role="builder"
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 Task received!

      <task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: 10007;chatroom_tasks
      Origin Message ID: 10006;chatroom_messages
      From: user

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10002;chatroom_rooms" --role="builder"\`

      ## Task
      To read this task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="10007;chatroom_tasks"
      \`\`\`

      ## Attached Backlog (1)
      - [BACKLOG] Fix: Agent lacks knowledge of backlog listing

      Add backlog section to get-next-task
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.

      1. Read task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="10007;chatroom_tasks"\`
      2. Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="10007;chatroom_tasks" --origin-message-classification=<type>\`

         new_feature example:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10002;chatroom_rooms" --role="builder" --task-id="10007;chatroom_tasks" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      3. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="10002;chatroom_rooms" --role="builder" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF\`
      4. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="10002;chatroom_rooms" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: reviewer, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10002;chatroom_rooms" --role="builder"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10002;chatroom_rooms" --role="builder"\` for current task.
      ============================================================
      "
    `);

    // ===== VERIFY INIT PROMPT =====
    expect(initPrompt).toBeDefined();
    expect(initPrompt?.prompt).toBeDefined();

    // Should have role header
    expect(initPrompt?.prompt).toContain('# Pair Team');
    expect(initPrompt?.prompt).toContain('## Your Role: BUILDER');

    // Should have Getting Started section (not Available Actions)
    expect(initPrompt?.prompt).toContain('## Getting Started');
    expect(initPrompt?.prompt).toContain('### Context Recovery (after compaction/summarization)');
    expect(initPrompt?.prompt).toContain('### Get Next Task');

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
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY FULL CLI OUTPUT FORMAT =====
    const fullOutput = taskDeliveryPrompt.fullCliOutput;

    // Should have consolidated NEXT STEPS section with inline guidance
    expect(fullOutput).toContain('Hand off');
    expect(fullOutput).toContain(chatroomId);
    expect(fullOutput).toContain('--role="builder"');

    // Should have environment variable prefix
    expect(fullOutput).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

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

    // Should have attached backlog item in context
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItemIds).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItemIds?.length).toBeGreaterThan(0);
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItems).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItems?.length).toBeGreaterThan(0);

    // Verify backlog item details
    const attachedItem = jsonContext.contextWindow.originMessage?.attachedBacklogItems?.[0];
    expect(attachedItem).toBeDefined();
    expect(attachedItem?.content).toContain('Fix: Agent lacks knowledge');
    expect(attachedItem?.status).toBe('backlog');

    // Should have role prompt context
    expect(jsonContext.rolePrompt).toBeDefined();
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

    // CLI needs task ID to show in TASK section
    expect(jsonContext.task._id).toBeDefined();
    expect(typeof jsonContext.task._id).toBe('string');

    // CLI needs message ID if present
    expect(jsonContext.message?._id).toBeDefined();

    // CLI needs origin message for TASK section
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
      rawStdin: `---TITLE---
User Authentication
---DESCRIPTION---
Add login/logout functionality
---TECH_SPECS---
Use JWT tokens, bcrypt for passwords`,
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


describe('Get-Next-Task Error Prompts', () => {
  test('materializes complete interrupt signal reconnection prompt', () => {
    // This test validates the prompt shown when process receives interrupt signal (SIGINT, SIGTERM, SIGHUP)
    const chatroomId = 'jx750h696te75x67z5q6cbwkph7zvm2x';
    const role = 'reviewer';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';

    // Simulate the exact prompt shown when signal interrupt occurs
    const signalTime = '2026-01-26 11:35:22'; // Example timestamp
    const fullSignalPrompt = `
──────────────────────────────────────────────────
⚠️  RECONNECTION REQUIRED

[${signalTime}] Why: Process interrupted (unexpected termination)
Impact: You are no longer listening for tasks
Action: Run this command immediately to resume availability

${cliEnvPrefix} chatroom get-next-task --chatroom-id=${chatroomId} --role=${role}
──────────────────────────────────────────────────
`;

    // Verify the complete prompt matches expected format
    expect(fullSignalPrompt).toMatchInlineSnapshot(`
      "
      ──────────────────────────────────────────────────
      ⚠️  RECONNECTION REQUIRED

      [2026-01-26 11:35:22] Why: Process interrupted (unexpected termination)
      Impact: You are no longer listening for tasks
      Action: Run this command immediately to resume availability

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=reviewer
      ──────────────────────────────────────────────────
      "
    `);

    // Verify key components are present
    expect(fullSignalPrompt).toContain('RECONNECTION REQUIRED');
    expect(fullSignalPrompt).toContain('Process interrupted');
    expect(fullSignalPrompt).toContain('unexpected termination');
    expect(fullSignalPrompt).toContain('You are no longer listening for tasks');
    expect(fullSignalPrompt).toContain('Run this command immediately');
    expect(fullSignalPrompt).toContain(cliEnvPrefix);
    expect(fullSignalPrompt).toContain(
      `chatroom get-next-task --chatroom-id=${chatroomId} --role=${role}`
    );
    expect(fullSignalPrompt).toContain(`[${signalTime}]`);
  });

  test('all reconnection prompts follow consistent format', () => {
    // Verify that all reconnection prompts follow the same structure
    const chatroomId = 'test123';
    const role = 'builder';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';
    const timestamp = '2026-01-26 12:00:00';

    const prompts = [
      {
        name: 'Signal Interrupt',
        prompt: `
──────────────────────────────────────────────────
⚠️  RECONNECTION REQUIRED

[${timestamp}] Why: Process interrupted (unexpected termination)
Impact: You are no longer listening for tasks
Action: Run this command immediately to resume availability

${cliEnvPrefix} chatroom get-next-task --chatroom-id=${chatroomId} --role=${role}
──────────────────────────────────────────────────
`,
      },
    ];

    // All prompts should have consistent structure
    for (const { name, prompt } of prompts) {
      expect(prompt, `${name} prompt should have header`).toContain('RECONNECTION REQUIRED');
      expect(prompt, `${name} prompt should have timestamp`).toContain(`[${timestamp}]`);
      expect(prompt, `${name} prompt should have Why`).toContain('Why:');
      expect(prompt, `${name} prompt should have Impact`).toContain('Impact:');
      expect(prompt, `${name} prompt should have Action`).toContain('Action:');
      expect(prompt, `${name} prompt should have command`).toContain('chatroom get-next-task');
      expect(prompt, `${name} prompt should have chatroom ID`).toContain(chatroomId);
      expect(prompt, `${name} prompt should have role`).toContain(role);
      expect(prompt, `${name} prompt should have env prefix`).toContain(cliEnvPrefix);
    }
  });
});

describe('Reviewer Get-Next-Task Prompt After Handoff', () => {
  test('materializes complete get-next-task message for reviewer receiving handoff from builder', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-reviewer-handoff-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message to builder
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Add dark mode toggle to the application',
      type: 'message',
    });

    // Builder claims, starts, and classifies the task
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const builderStartResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: builderStartResult.taskId,
      originMessageClassification: 'new_feature',
      rawStdin: `---TITLE---
Dark Mode Toggle
---DESCRIPTION---
Add a toggle in settings for dark/light mode
---TECH_SPECS---
Use React Context + CSS variables`,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Builder hands off to reviewer
    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: `Implemented dark mode toggle. Please review.

Changes:
- Added ThemeProvider context
- Created toggle component in Settings
- Applied CSS variables for theming

Testing: Toggle in settings switches between light/dark modes`,
      targetRole: 'reviewer',
    });

    // Reviewer claims the task
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    const reviewerStartResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'reviewer',
    });

    // Get the init prompt for reviewer
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Get the task delivery prompt for reviewer
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      taskId: reviewerStartResult.taskId,
      messageId: handoffResult.messageId ?? undefined,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // ===== OUTPUT COMPLETE CLI MESSAGE FOR REVIEW =====
    // This materializes the exact message structure sent from server to get-next-task command
    // Init section (CLI-generated) + Task delivery section (backend-generated via fullCliOutput)

    const role = 'reviewer';

    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "${role}"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

${getNextTaskGuidance()}

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════
-->

[TIMESTAMP] 📨 Task received!

${taskDeliveryPrompt.fullCliOutput}
`;

    // Verify the complete message structure matches expected format
    // The inline snapshot will materialize the full message for human review in the test file
    expect(fullCliMessage).toMatchInlineSnapshot(`
      "
      [TIMESTAMP] ⏳ Connecting to chatroom as "reviewer"...
      [TIMESTAMP] ✅ Connected. Waiting for task...

      <!-- REFERENCE: Agent Initialization

      ══════════════════════════════════════════════════
      📋 AGENT INITIALIZATION PROMPT
      ══════════════════════════════════════════════════

      🔗 STAYING CONNECTED TO YOUR TEAM

      Your primary directive: Stay available to receive tasks from your team.

      Run \`get-next-task\` after completing work and handing off. This is how your team sends you the next task.

      If interrupted or restarted: finish any in-progress work, then run \`get-next-task\` to reconnect.

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating code changes.

      # Glossary

      - \`backlog\` (1 skill available)
          - The list of work items the team intends to do but has not yet started. Agents use the \`chatroom backlog\` CLI command group to manage backlog items.

      - \`software-engineering\` (1 skill available)
          - Universal software engineering standards: build from the application core outward, SOLID principles, and naming conventions.

      # Skills

      Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom skill list --chatroom-id=<id> --role=<role>\` to list all available skills.

      ## Getting Started

      ### Workflow Loop

      \`\`\`mermaid
      flowchart LR
          A([Start]) --> B[register-agent]
          B --> C[get-next-task
      waiting...]
          C --> D[task read
      marks in_progress]
          D --> E[Do Work]
          E --> F[handoff]
          F --> C
      \`\`\`

      ### ⚠️ CRITICAL: Read the task immediately

      When you receive a task from \`get-next-task\`, the task content is hidden. You **MUST** run \`task read\` immediately to:

      1. **Get the task content** — the full task description
      2. **Mark it as in_progress** — signals you're working on it

      Failure to run \`task read\` promptly may trigger the system to restart you.

      ### Context Recovery (after compaction/summarization)

      NOTE: If you are an agent that has undergone compaction or summarization, run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10048;chatroom_rooms" --role="reviewer"
      to reload your full system and role prompt. Then run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10048;chatroom_rooms" --role="reviewer"
      to see your current task context.

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id="10048;chatroom_rooms" --role="reviewer" --type=<remote|custom>
      \`\`\`

      ### Get Next Task
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10048;chatroom_rooms" --role="reviewer"
      \`\`\`


      ### Start Working

      ⚠️  **RUN THIS IMMEDIATELY** after receiving a handoff.
      This marks the task as in_progress and prevents unnecessary agent restarts.

      Before starting work on a received message, acknowledge it:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="10048;chatroom_rooms" --role="reviewer" --task-id=<task-id> --no-classify
      \`\`\`

      This transitions the task to \`in_progress\`. Classification was already done by the agent who received the original user message.


       **Pair Team Context:**
       - You work with a builder who implements code
       - Focus on code quality and requirements
       - Provide constructive feedback to builder
       - If the user's goal is met → hand off to user
       - If changes are needed → hand off to builder with specific feedback
       
       
      ## Reviewer Workflow

      You receive handoffs from other agents containing work to review or validate.

      **Typical Flow:**

      \`\`\`mermaid
      flowchart TD
          A([Start]) --> B[Receive handoff]
          B -->|from builder or other agent| C[Run task read]
          C --> D[Review code changes]
          D --> E{Meets requirements?}
          E -->|yes| F[Hand off to user]
          F --> G([APPROVED ✅])
          E -->|no| H[Hand off to builder]
          H --> I([Provide specific feedback])
      \`\`\`

      **Your Options After Review:**

      **If changes are needed:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="<chatroom-id>" --role="<role>" --next-role="builder" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with your detailed feedback:
      - **Issues Found**: List specific problems
      - **Suggestions**: Provide actionable recommendations

      **If work is approved:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="<chatroom-id>" --role="<role>" --next-role="user" << 'EOF'
      ---MESSAGE---
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

       

      ### Handoff Options
      Available targets: builder, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="10048;chatroom_rooms" --role="reviewer" --next-role="<target>" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id="10048;chatroom_rooms" --role="reviewer" << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10048;chatroom_rooms" --role="reviewer"
      \`\`\`

      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.

      **Reference commands:**
      - List recent messages: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id="10048;chatroom_rooms" --role="reviewer" --sender-role=user --limit=5 --full\`
      - Git log: \`git log --oneline -10\`

      **Recovery commands** (only needed after compaction/restart):
      - Reload system prompt: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10048;chatroom_rooms" --role="reviewer"\`
      - Read current task context: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10048;chatroom_rooms" --role="reviewer"\`

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="10048;chatroom_rooms" --role="reviewer"
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 Task received!

      <task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: 10063;chatroom_tasks
      Origin Message ID: 10062;chatroom_messages
      From: builder

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10048;chatroom_rooms" --role="reviewer"\`

      ## Task
      To read this task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="10048;chatroom_rooms" --role="reviewer" --task-id="10063;chatroom_tasks"
      \`\`\`

      Classification: NEW_FEATURE
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.
         handed off from builder — start work immediately.

      1. Read task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="10048;chatroom_rooms" --role="reviewer" --task-id="10063;chatroom_tasks"\`
      2. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="10048;chatroom_rooms" --role="reviewer" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="10048;chatroom_rooms" --role="reviewer"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="10048;chatroom_rooms" --role="reviewer"\` for current task.
      ============================================================
      "
    `);

    // ===== VERIFY INIT PROMPT =====
    expect(initPrompt).toBeDefined();
    expect(initPrompt?.prompt).toBeDefined();

    // Should have role header
    expect(initPrompt?.prompt).toContain('## Your Role: REVIEWER');

    // Should have Getting Started section
    expect(initPrompt?.prompt).toContain('## Getting Started');
    expect(initPrompt?.prompt).toContain('### Context Recovery (after compaction/summarization)');
    expect(initPrompt?.prompt).toContain('### Get Next Task');

    // CRITICAL: Should have task-started instruction for reviewer (without classification)
    // Reviewer receives handoffs, not user messages, so no classification needed
    expect(initPrompt?.prompt).toContain('### Start Working');
    expect(initPrompt?.prompt).toContain('--no-classify');

    // Should NOT have classification section (that's only for entry point roles)
    expect(initPrompt?.prompt).not.toContain('### Classify Task');
    expect(initPrompt?.prompt).not.toContain('--origin-message-classification');

    // Should have reviewer workflow instructions
    expect(initPrompt?.prompt).toContain('## Reviewer Workflow');

    // ===== VERIFY TASK DELIVERY PROMPT =====
    expect(taskDeliveryPrompt).toBeDefined();
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY FULL CLI OUTPUT FORMAT =====
    const fullOutput = taskDeliveryPrompt.fullCliOutput;

    // Should have handoff targets in NEXT STEPS
    expect(fullOutput).toContain('Hand off');
    expect(fullOutput).toContain(chatroomId);
    expect(fullOutput).toContain('--role="reviewer"');

    // ===== VERIFY JSON CONTEXT =====
    const jsonContext = taskDeliveryPrompt.json;

    // Should have task information
    expect(jsonContext.task).toBeDefined();
    expect(jsonContext.task._id).toBe(reviewerStartResult.taskId);
    expect(jsonContext.task.status).toBe('in_progress');

    // Should have handoff message information
    expect(jsonContext.message).toBeDefined();
    expect(jsonContext.message?._id).toBe(handoffResult.messageId);
    expect(jsonContext.message?.senderRole).toBe('builder');
    expect(jsonContext.message?.content).toContain('Implemented dark mode toggle');

    // Should have origin message in context (the original user message)
    expect(jsonContext.contextWindow.originMessage).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.content).toBe(
      'Add dark mode toggle to the application'
    );
    expect(jsonContext.contextWindow.originMessage?.senderRole).toBe('user');
    expect(jsonContext.contextWindow.originMessage?.classification).toBe('new_feature');

    // Should have role prompt context
    expect(jsonContext.rolePrompt).toBeDefined();
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('builder');
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('user');
  });
});

describe('Get-Next-Task Recent Improvements', () => {
  test('guidance text contains updated content (no longer references timeouts)', () => {
    const guidance = getNextTaskGuidance();
    const reminder = getNextTaskReminder();

    // Updated guidance should contain key sections
    expect(guidance).toContain('STAYING CONNECTED TO YOUR TEAM');
    expect(guidance).toContain('get-next-task');
    expect(guidance).toContain('Stay available to receive tasks from your team');

    // Should NOT contain shell-specific language that is misleading for coding agents
    expect(guidance).not.toContain('FOREGROUND');
    expect(guidance).not.toContain('nohup');
    expect(guidance).not.toContain('backgrounding');
    expect(guidance).not.toContain('active terminal');
    expect(guidance).not.toContain('blocking execution');
    expect(guidance).not.toContain('HOW WAIT-FOR-TASK WORKS');
    expect(guidance).not.toContain('The command may timeout before a task arrives');

    // Reminder should be a single-line reminder
    expect(reminder).toContain('Message availability is critical');
    expect(reminder).toContain('get-next-task');
  });

  test('attached backlog tasks appear in task delivery prompt JSON', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-attached-backlog-in-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Recovery of acknowledged tasks: implement 1-min grace period',
      createdBy: 'user',
    });

    // User sends message with the backlog item attached
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can we work on this task?',
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

    // Get the task delivery prompt
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      messageId: userMessageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Verify attached backlog items appear in the prompt JSON
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;
    expect(originMessage).toBeDefined();
    expect(originMessage?.attachedBacklogItems).toBeDefined();
    expect(originMessage?.attachedBacklogItems?.length).toBe(1);

    const attachedItem = originMessage?.attachedBacklogItems?.[0];
    expect(attachedItem?.content).toBe(
      'Recovery of acknowledged tasks: implement 1-min grace period'
    );
    expect(attachedItem?.status).toBeDefined();

    // Verify the full CLI output also exists
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.fullCliOutput.length).toBeGreaterThan(0);
  });

  test('getPendingTasksForRole returns acknowledged tasks for recovery', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-acknowledged-task-recovery');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends a message (creates a pending task for builder)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please implement the dark mode feature',
      type: 'message',
    });

    // Verify pending task is returned
    const pendingResult = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(pendingResult.type).toBe('tasks');
    const pendingTasks = (pendingResult as { type: 'tasks'; tasks: any[] }).tasks;
    expect(pendingTasks.length).toBe(1);
    expect(pendingTasks[0].task.status).toBe('pending');

    // Builder claims the task (transitions to acknowledged)
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Verify acknowledged task returns grace_period (recently acknowledged)
    const acknowledgedResult = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(acknowledgedResult.type).toBe('grace_period');
    expect((acknowledgedResult as { type: 'grace_period'; taskId: string }).taskId).toBeDefined();
    expect(
      (acknowledgedResult as { type: 'grace_period'; remainingMs: number }).remainingMs
    ).toBeGreaterThan(0);
  });

  test('init prompt contains backlog and guidance sections', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-init-prompt-sections');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Get the init prompt
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();
    expect(initPrompt?.prompt).toBeDefined();

    // Init prompt should contain the role setup and commands
    const prompt = initPrompt!.prompt;
    expect(prompt).toContain('## Your Role: BUILDER');
    expect(prompt).toContain('## Getting Started');
    expect(prompt).toContain('chatroom get-next-task');
    expect(prompt).toContain('chatroom context read');

    // Init prompt should contain the get-next-task reminder
    expect(prompt).toContain(getNextTaskReminder());
  });

  test('getPendingTasksForRole returns no_tasks when no tasks exist', async () => {
    const { sessionId } = await createTestSession('test-no-tasks-response');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.type).toBe('no_tasks');
  });

  test('getPendingTasksForRole returns superseded when connectionId does not match', async () => {
    const { sessionId } = await createTestSession('test-superseded-response');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Join with a specific connectionId
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-current',
    });
    await joinParticipants(sessionId, chatroomId, ['reviewer']);

    // Query with a stale connectionId
    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-stale',
    });
    expect(result.type).toBe('superseded');
    expect((result as { type: 'superseded'; newConnectionId: string }).newConnectionId).toBe(
      'conn-current'
    );
  });

  test('getPendingTasksForRole returns error for invalid session', async () => {
    // Create a valid session to create the chatroom
    const { sessionId } = await createTestSession('test-error-response');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Query with an invalid session
    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId: 'invalid-session-id' as SessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.type).toBe('error');
    const errorResult = result as { type: 'error'; code: string; message: string; fatal: boolean };
    expect(errorResult.fatal).toBe(true);
    expect(errorResult.code).toBeDefined();
    expect(errorResult.message).toBeDefined();
  });

  test('getPendingTasksForRole returns grace_period for recently acknowledged task', async () => {
    const { sessionId } = await createTestSession('test-grace-period-response');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Send a message to create a task
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Build a feature',
      type: 'message',
    });

    // Claim the task (pending → acknowledged)
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Query immediately — task was just acknowledged, should be in grace period
    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.type).toBe('grace_period');
    const gracePeriod = result as {
      type: 'grace_period';
      taskId: string;
      remainingMs: number;
    };
    expect(gracePeriod.taskId).toBeDefined();
    expect(gracePeriod.remainingMs).toBeGreaterThan(0);
    expect(gracePeriod.remainingMs).toBeLessThanOrEqual(60_000);
  });

  test('attached chatroom_backlog items (Attach to Context) appear in CLI output and JSON', async () => {
    // Regression test for: bb701b29
    // Bug: backlog items attached via "Attach to Context" (using chatroom_backlog table, not
    // chatroom_tasks) were stored correctly in attachedBacklogItemIds but were never passed to
    // generateFullCliOutput — so agents never saw them in the task delivery output.

    const { sessionId } = await createTestSession('test-backlog-item-attach-to-context');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a chatroom_backlog item (created via the backlog tab, not via createTask)
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Refactor: extract shared auth helpers into a utility module',
      createdBy: 'user',
    });

    // User attaches the backlog item and sends a message — simulates clicking "Attach to Context"
    // Note: this uses attachedBacklogItemIds (chatroom_backlog), NOT attachedTaskIds (chatroom_tasks)
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you work on this backlog item?',
      type: 'message',
      attachedBacklogItemIds: [backlogItemId],
    });

    // Builder claims and starts the task
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
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

    // ── Verify JSON context has the attached backlog item ──────────────────────
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;
    expect(originMessage).toBeDefined();

    // The backlog item ID should appear in attachedBacklogItemIds
    expect(originMessage?.attachedBacklogItemIds).toBeDefined();
    expect(originMessage?.attachedBacklogItemIds).toContain(backlogItemId);

    // The resolved item should appear in attachedBacklogItems
    expect(originMessage?.attachedBacklogItems).toBeDefined();
    expect(originMessage?.attachedBacklogItems?.length).toBe(1);
    const attachedItem = originMessage?.attachedBacklogItems?.[0];
    expect(attachedItem?.content).toBe('Refactor: extract shared auth helpers into a utility module');
    expect(attachedItem?.status).toBe('backlog');

    // ── Verify CLI output contains the item in ## Attached Backlog ────────────
    const fullOutput = taskDeliveryPrompt.fullCliOutput;
    expect(fullOutput).toContain('## Attached Backlog (1)');
    expect(fullOutput).toContain('- [BACKLOG] Refactor: extract shared auth helpers into a utility module');
  });
});
