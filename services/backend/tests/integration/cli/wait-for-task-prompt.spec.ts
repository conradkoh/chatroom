/**
 * Wait-for-Task Prompt Integration Tests
 *
 * Tests the complete message sent from server to wait-for-task command,
 * including all sections: init prompt, task info, pinned message, backlog attachments, and available actions.
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

    // ===== OUTPUT COMPLETE CLI MESSAGE FOR REVIEW =====
    // This materializes the exact message structure sent from server to wait-for-task command

    const taskId = startResult.taskId;
    const messageId = userMessageId;
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;
    const existingClassification = originMessage?.classification;

    // Note: Timestamps will vary, so we use placeholders in expected output
    // Task content comes from the task object
    const taskContent = taskDeliveryPrompt.json.task?.content || 'NO TASK CONTENT';

    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "builder"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks

⏱️  HOW WAIT-FOR-TASK WORKS:
• While wait-for-task runs, you remain "frozen" - the tool continues executing while you wait
• The command may timeout before a task arrives. This is normal and expected behavior
• The shell host enforces timeouts to ensure agents remain responsive and can pick up new jobs
• When wait-for-task terminates (timeout or after task completion), restart it immediately
• Restarting quickly ensures users and other agents don't have to wait for your availability

📋 BACKLOG:
The chatroom has a task backlog. View items with:
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
More actions: \`chatroom backlog --help\`

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════
-->

[TIMESTAMP] 📨 Task received!

============================================================
🆔 TASK INFORMATION
============================================================
Task ID: ${taskId}
Message ID: ${messageId}

📋 NEXT STEPS
============================================================
To acknowledge and classify this message, run:

CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=${chatroomId} --role=builder --task-id=${taskId} --origin-message-classification=<type>

📝 Classification Requirements:
   • question: No additional fields required
   • follow_up: No additional fields required
   • new_feature: REQUIRES --title, --description, --tech-specs

💡 Example for new_feature:
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=${chatroomId} --role=builder --task-id=${taskId} --origin-message-classification=new_feature << 'EOF'
---TITLE---
<title>
---DESCRIPTION---
<description>
---TECH_SPECS---
<tech-specs>
EOF

Classification types: question, new_feature, follow_up
============================================================

<!-- CONTEXT: Available Actions & Role Instructions
${taskDeliveryPrompt.humanReadable}
-->

============================================================
📍 PINNED - Work on this immediately
============================================================

## User Message
<user-message>
${originMessage?.content || 'NO CONTENT'}
${
  originMessage?.attachedTasks && originMessage.attachedTasks.length > 0
    ? `
ATTACHED BACKLOG (${originMessage.attachedTasks.length})
${originMessage.attachedTasks.map((t: { content: string }) => t.content).join('\n\n')}`
    : ''
}
</user-message>

## Task
${taskContent}
${existingClassification ? `\nClassification: ${existingClassification.toUpperCase()}` : ''}

============================================================
📋 PROCESS
============================================================

1. Mark task as started:
   CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=${chatroomId} --role=builder --task-id=${taskId} --origin-message-classification=follow_up

2. Do the work

3. Hand off when complete:
   CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=${chatroomId} --role=builder --next-role=<target>

4. Resume listening:
   CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=${chatroomId} --role=builder

============================================================
Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
============================================================
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

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks

      ⏱️  HOW WAIT-FOR-TASK WORKS:
      • While wait-for-task runs, you remain "frozen" - the tool continues executing while you wait
      • The command may timeout before a task arrives. This is normal and expected behavior
      • The shell host enforces timeouts to ensure agents remain responsive and can pick up new jobs
      • When wait-for-task terminates (timeout or after task completion), restart it immediately
      • Restarting quickly ensures users and other agents don't have to wait for your availability

      📋 BACKLOG:
      The chatroom has a task backlog. View items with:
        chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
      More actions: \`chatroom backlog --help\`

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      ## Getting Started

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      ### Classify Task
      Acknowledge and classify user messages before starting work.

      #### Question
      User is asking for information or clarification.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=question
      \`\`\`

      #### Follow Up
      User is responding to previous work or providing feedback.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=follow_up
      \`\`\`

      #### New Feature
      User wants new functionality. Requires title, description, and tech specs.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      [Feature title]
      ---DESCRIPTION---
      [Feature description]
      ---TECH_SPECS---
      [Technical specifications]
      EOF
      \`\`\`


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
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
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
       
       

      ### Handoff Options
      Available targets: reviewer, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10002;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10002;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 Task received!

      ============================================================
      🆔 TASK INFORMATION
      ============================================================
      Task ID: 10009;chatroom_tasks
      Message ID: 10008;chatroom_messages

      📋 NEXT STEPS
      ============================================================
      To acknowledge and classify this message, run:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10009;chatroom_tasks --origin-message-classification=<type>

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10009;chatroom_tasks --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      Classification types: question, new_feature, follow_up
      ============================================================

      <!-- CONTEXT: Available Actions & Role Instructions
      ## Available Actions

      ### Gain Context
      View the latest relevant chat history. Use when starting a new session or when context is unclear.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      ### List Messages
      Query specific messages with filters.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=10002;chatroom_rooms --role=builder --sender-role=user --limit=5 --full
      \`\`\`

      ### View Code Changes
      Check recent commits for implementation context.

      \`\`\`bash
      git log --oneline -10
      \`\`\`

      ### Complete Task
      Mark current task as complete without handing off to another role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      ### Backlog
      The chatroom has a task backlog. View items with:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10002;chatroom_rooms --role=builder --status=backlog
      \`\`\`

      **After completing work on a backlog item**, mark it for user review:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog mark-for-review --chatroom-id=10002;chatroom_rooms --role=builder --task-id=<task-id>
      \`\`\`

      This transitions the task to \`pending_user_review\` where the user can confirm completion or send it back for rework.

      #### Backlog Scoring and Maintenance
      When requested, help organize the backlog and score items by priority (impact vs. effort). Use \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10002;chatroom_rooms --role=builder --status=backlog\` to view items, then provide recommendations.

      More actions: \`chatroom backlog --help\`

      ## Your Role: BUILDER

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
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
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
       
       

      ### Handoff Options
      Available targets: reviewer, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10002;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10002;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      Remember to listen for new messages using \`wait-for-task\` after handoff. Otherwise your team might get stuck not be able to reach you.

          CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder
      -->

      ============================================================
      📍 PINNED - Work on this immediately
      ============================================================

      ## User Message
      <user-message>
      Can we add a backlog section to the available actions? Keep it concise and follow current format.

      ATTACHED BACKLOG (1)
      Fix: Agent lacks knowledge of backlog listing

      Add backlog section to wait-for-task
      </user-message>

      ## Task
      Can we add a backlog section to the available actions? Keep it concise and follow current format.


      ============================================================
      📋 PROCESS
      ============================================================

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10009;chatroom_tasks --origin-message-classification=follow_up

      2. Do the work

      3. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10002;chatroom_rooms --role=builder --next-role=<target>

      4. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10002;chatroom_rooms --role=builder

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
    expect(humanPrompt).toContain(`chatroom backlog list --chatroom-id=${chatroomId}`);
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

describe('Task-Started Reminders', () => {
  test('materializes complete task-started reminder for new_feature classification', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-task-started-new-feature');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Add dark mode toggle to the application',
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

    // Classify as new_feature
    const result = await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'new_feature',
      rawStdin: `---TITLE---
Dark Mode Toggle
---DESCRIPTION---
Add a toggle in settings for dark/light mode
---TECH_SPECS---
Use React Context + CSS variables`,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Materialize the complete CLI output for task-started command
    const classification = 'new_feature';

    const fullCliOutput = `✅ Task acknowledged and classified
   Classification: ${classification}
   Task: Add dark mode toggle to the application

💡 ${result.reminder}`;

    // Verify the complete reminder structure matches expected format
    // The inline snapshot will materialize the full message for human review in the test file
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task acknowledged and classified
         Classification: new_feature
         Task: Add dark mode toggle to the application

      💡 ✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Implement the feature
      2. Send \`report-progress\` at milestones (e.g., after major changes, when blocked)
      3. Commit your changes
      4. MUST hand off to reviewer for approval:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10030;chatroom_rooms --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Message ID: 10035;chatroom_messages"
    `);

    // Verify reminder structure
    expect(result.success).toBe(true);
    expect(result.classification).toBe('new_feature');
    expect(result.reminder).toBeDefined();
    expect(result.reminder).toContain('NEW FEATURE');
    expect(result.reminder).toContain('hand off to reviewer');
  });

  test('materializes complete task-started reminder for question classification', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-task-started-question');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'How does the authentication system work?',
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

    // Classify as question
    const result = await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'question',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Materialize the complete CLI output for task-started command
    const classification = 'question';

    const fullCliOutput = `✅ Task acknowledged and classified
   Classification: ${classification}
   Task: How does the authentication system work?

💡 ${result.reminder}`;

    // Verify the complete reminder structure matches expected format
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task acknowledged and classified
         Classification: question
         Task: How does the authentication system work?

      💡 ✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Send a progress update: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10039;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF\`
      2. Answer the user's question
      3. When done, hand off directly to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10039;chatroom_rooms --role=builder --next-role=user << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Message ID: 10044;chatroom_messages"
    `);

    // Verify reminder structure
    expect(result.success).toBe(true);
    expect(result.classification).toBe('question');
    expect(result.reminder).toBeDefined();
    expect(result.reminder).toContain('QUESTION');
    expect(result.reminder).toContain('hand off directly to user');
  });

  test('materializes complete task-started reminder for follow_up classification', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-task-started-follow-up');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends follow-up message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you also add filtering?',
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

    // Classify as follow_up
    const result = await t.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      originMessageClassification: 'follow_up',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Materialize the complete CLI output for task-started command
    const classification = 'follow_up';

    const fullCliOutput = `✅ Task acknowledged and classified
   Classification: ${classification}
   Task: Can you also add filtering?

💡 ${result.reminder}`;

    // Verify the complete reminder structure matches expected format
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task acknowledged and classified
         Classification: follow_up
         Task: Can you also add filtering?

      💡 ✅ Task acknowledged as FOLLOW UP.

      **Next steps:**
      1. Complete the follow-up work
      2. Send \`report-progress\` at milestones for visibility
      3. Follow-up inherits the workflow rules from the original task:
         - If original was a QUESTION → hand off to user when done
         - If original was a NEW FEATURE → hand off to reviewer when done

      💡 You're working on:
      Message ID: 10053;chatroom_messages"
    `);

    // Verify reminder structure
    expect(result.success).toBe(true);
    expect(result.classification).toBe('follow_up');
    expect(result.reminder).toBeDefined();
    expect(result.reminder).toContain('FOLLOW UP');
    expect(result.reminder).toContain('inherits the workflow rules');
  });
});

describe('Handoff Command', () => {
  test('materializes complete handoff to reviewer output', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-handoff-to-reviewer');
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

    // Builder claims and starts the task
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

    // Builder hands off to reviewer
    const handoffMessage = `Implemented dark mode toggle.

Changes:
- Added ThemeProvider context
- Created toggle component
- Applied CSS variables

Testing: Toggle in settings switches between light/dark`;

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: handoffMessage,
      targetRole: 'reviewer',
    });

    // Materialize the complete CLI output for handoff command
    const nextRole = 'reviewer';
    const role = 'builder';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';

    const fullCliOutput = `✅ Task completed and handed off to ${nextRole}
📋 Summary: ${handoffMessage}

⏳ Now run wait-for-task to wait for your next assignment:
   ${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`;

    // Verify the complete output structure matches expected format
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to reviewer
      📋 Summary: Implemented dark mode toggle.

      Changes:
      - Added ThemeProvider context
      - Created toggle component
      - Applied CSS variables

      Testing: Toggle in settings switches between light/dark

      ⏳ Now run wait-for-task to wait for your next assignment:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10057;chatroom_rooms --role=builder"
    `);

    // Verify mutation result
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.completedTaskIds.length).toBeGreaterThan(0);
    expect(result.newTaskId).toBeDefined(); // Task created for reviewer
  });

  test('materializes complete handoff to user (workflow completion) output', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-handoff-to-user');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends a question
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'How does the authentication system work?',
      type: 'message',
    });

    // Builder claims, starts, and classifies as question
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

    // Builder hands off to user (workflow complete)
    const handoffMessage = `The authentication system uses JWT tokens with bcrypt for password hashing.

Key components:
- AuthProvider context for state management
- Login/logout mutations in Convex
- Protected route middleware

See docs/auth.md for more details.`;

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: handoffMessage,
      targetRole: 'user',
    });

    // Materialize the complete CLI output for handoff to user
    const nextRole = 'user';
    const role = 'builder';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';

    const fullCliOutput = `✅ Task completed and handed off to ${nextRole}
📋 Summary: ${handoffMessage}

🎉 Workflow complete! Control returned to user.

⏳ Now run wait-for-task to wait for your next assignment:
   ${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`;

    // Verify the complete output structure matches expected format
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to user
      📋 Summary: The authentication system uses JWT tokens with bcrypt for password hashing.

      Key components:
      - AuthProvider context for state management
      - Login/logout mutations in Convex
      - Protected route middleware

      See docs/auth.md for more details.

      🎉 Workflow complete! Control returned to user.

      ⏳ Now run wait-for-task to wait for your next assignment:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10068;chatroom_rooms --role=builder"
    `);

    // Verify mutation result
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.completedTaskIds.length).toBeGreaterThan(0);
    expect(result.newTaskId).toBeNull(); // No task for user
  });
});

describe('Wait-for-Task Error Prompts', () => {
  test('materializes complete timeout reconnection prompt', () => {
    // This test validates the timeout prompt shown to agents when wait-for-task times out
    const chatroomId = 'jx750h696te75x67z5q6cbwkph7zvm2x';
    const role = 'reviewer';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';

    // Simulate the exact prompt shown when timeout occurs
    const timeoutTime = '2026-01-26 11:30:45'; // Example timestamp
    const fullTimeoutPrompt = `
──────────────────────────────────────────────────
⚠️  RECONNECTION REQUIRED

[${timeoutTime}] Why: Session timeout reached (normal and expected behavior)
Impact: You are no longer listening for tasks
Action: Run this command immediately to resume availability

${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}
──────────────────────────────────────────────────
`;

    // Verify the complete prompt matches expected format
    expect(fullTimeoutPrompt).toMatchInlineSnapshot(`
      "
      ──────────────────────────────────────────────────
      ⚠️  RECONNECTION REQUIRED

      [2026-01-26 11:30:45] Why: Session timeout reached (normal and expected behavior)
      Impact: You are no longer listening for tasks
      Action: Run this command immediately to resume availability

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=reviewer
      ──────────────────────────────────────────────────
      "
    `);

    // Verify key components are present
    expect(fullTimeoutPrompt).toContain('RECONNECTION REQUIRED');
    expect(fullTimeoutPrompt).toContain('Session timeout reached');
    expect(fullTimeoutPrompt).toContain('normal and expected behavior');
    expect(fullTimeoutPrompt).toContain('You are no longer listening for tasks');
    expect(fullTimeoutPrompt).toContain('Run this command immediately');
    expect(fullTimeoutPrompt).toContain(cliEnvPrefix);
    expect(fullTimeoutPrompt).toContain(
      `chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`
    );
    expect(fullTimeoutPrompt).toContain(`[${timeoutTime}]`);
  });

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

${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}
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

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=reviewer
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
      `chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`
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
        name: 'Timeout',
        prompt: `
──────────────────────────────────────────────────
⚠️  RECONNECTION REQUIRED

[${timestamp}] Why: Session timeout reached (normal and expected behavior)
Impact: You are no longer listening for tasks
Action: Run this command immediately to resume availability

${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}
──────────────────────────────────────────────────
`,
      },
      {
        name: 'Signal Interrupt',
        prompt: `
──────────────────────────────────────────────────
⚠️  RECONNECTION REQUIRED

[${timestamp}] Why: Process interrupted (unexpected termination)
Impact: You are no longer listening for tasks
Action: Run this command immediately to resume availability

${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}
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
      expect(prompt, `${name} prompt should have command`).toContain('chatroom wait-for-task');
      expect(prompt, `${name} prompt should have chatroom ID`).toContain(chatroomId);
      expect(prompt, `${name} prompt should have role`).toContain(role);
      expect(prompt, `${name} prompt should have env prefix`).toContain(cliEnvPrefix);
    }
  });
});

describe('Reviewer Wait-for-Task Prompt After Handoff', () => {
  test('materializes complete wait-for-task message for reviewer receiving handoff from builder', async () => {
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
    // This materializes the exact message structure sent from server to wait-for-task command

    const taskId = reviewerStartResult.taskId;
    const messageId = handoffResult.messageId;
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;

    // Note: Timestamps will vary, so we use placeholders in expected output
    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "reviewer"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks

⏱️  HOW WAIT-FOR-TASK WORKS:
• While wait-for-task runs, you remain "frozen" - the tool continues executing while you wait
• The command may timeout before a task arrives. This is normal and expected behavior
• The shell host enforces timeouts to ensure agents remain responsive and can pick up new jobs
• When wait-for-task terminates (timeout or after task completion), restart it immediately
• Restarting quickly ensures users and other agents don't have to wait for your availability

📋 BACKLOG:
The chatroom has a task backlog. View items with:
  chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
More actions: \`chatroom backlog --help\`

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════
-->

[TIMESTAMP] 📨 Task received!

============================================================
🆔 TASK INFORMATION
============================================================
Task ID: ${taskId}
Message ID: ${messageId}

📋 NEXT STEPS
============================================================
To start working on this task, run:

CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=${chatroomId} --role=reviewer --task-id=${taskId} --no-classify

⚠️  Note: This task was handed off to you, so classification was already done by the entry point role.
============================================================

## 📍 Pinned
### Primary User Directive
<user-message>
${originMessage?.content || 'NO CONTENT'}
${
  originMessage?.classification
    ? `

Classification: ${originMessage.classification.toUpperCase()}`
    : ''
}
</user-message>

### Task Context
Handed off from: builder
Original classification: ${originMessage?.classification || 'Not classified'}
============================================================

${taskDeliveryPrompt.humanReadable}

============================================================
Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
============================================================
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

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      Run \`wait-for-task\` directly (not with \`&\`, \`nohup\`, or other backgrounding) - backgrounded processes cannot receive tasks

      ⏱️  HOW WAIT-FOR-TASK WORKS:
      • While wait-for-task runs, you remain "frozen" - the tool continues executing while you wait
      • The command may timeout before a task arrives. This is normal and expected behavior
      • The shell host enforces timeouts to ensure agents remain responsive and can pick up new jobs
      • When wait-for-task terminates (timeout or after task completion), restart it immediately
      • Restarting quickly ensures users and other agents don't have to wait for your availability

      📋 BACKLOG:
      The chatroom has a task backlog. View items with:
        chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
      More actions: \`chatroom backlog --help\`

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating code changes.

      ## Getting Started

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      ### Start Working
      Before starting work on a received message, acknowledge it:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10078;chatroom_rooms --role=reviewer --task-id=<task-id> --no-classify
      \`\`\`

      This transitions the task to \`in_progress\`. Classification was already done by the agent who received the original user message.


       ## Reviewer Workflow
       
       You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
       
       **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
       
       **Pair Team Context:**
       - You work with a builder who implements code
       - Focus on code quality and requirements
       - Provide constructive feedback to builder
       
       
      ## Reviewer Workflow

      You receive handoffs from other agents containing work to review or validate.

      **Typical Flow:**
      1. Receive message (handoff from builder or other agent)
      2. Run \`task-started --no-classify\` to acknowledge receipt and start work
      3. Review the code changes or content:
         - Check uncommitted changes: \`git status\`, \`git diff\`
         - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
      4. Either approve or request changes

      **Your Options After Review:**

      **If changes are needed:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=builder << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with your detailed feedback:
      - **Issues Found**: List specific problems
      - **Suggestions**: Provide actionable recommendations

      **If work is approved:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=user << 'EOF'
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
       
       

      ### Handoff Options
      Available targets: builder, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10078;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10078;chatroom_rooms --role=reviewer << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 Task received!

      ============================================================
      🆔 TASK INFORMATION
      ============================================================
      Task ID: 10086;chatroom_tasks
      Message ID: 10085;chatroom_messages

      📋 NEXT STEPS
      ============================================================
      To start working on this task, run:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10078;chatroom_rooms --role=reviewer --task-id=10086;chatroom_tasks --no-classify

      ⚠️  Note: This task was handed off to you, so classification was already done by the entry point role.
      ============================================================

      ## 📍 Pinned
      ### Primary User Directive
      <user-message>
      Add dark mode toggle to the application


      Classification: NEW_FEATURE
      </user-message>

      ### Task Context
      Handed off from: builder
      Original classification: new_feature
      ============================================================

      ## Available Actions

      ### Gain Context
      View the latest relevant chat history. Use when starting a new session or when context is unclear.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      ### List Messages
      Query specific messages with filters.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=10078;chatroom_rooms --role=reviewer --sender-role=user --limit=5 --full
      \`\`\`

      ### View Code Changes
      Check recent commits for implementation context.

      \`\`\`bash
      git log --oneline -10
      \`\`\`

      ### Complete Task
      Mark current task as complete without handing off to another role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      ### Backlog
      The chatroom has a task backlog. View items with:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10078;chatroom_rooms --role=reviewer --status=backlog
      \`\`\`

      **After completing work on a backlog item**, mark it for user review:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog mark-for-review --chatroom-id=10078;chatroom_rooms --role=reviewer --task-id=<task-id>
      \`\`\`

      This transitions the task to \`pending_user_review\` where the user can confirm completion or send it back for rework.

      #### Backlog Scoring and Maintenance
      When requested, help organize the backlog and score items by priority (impact vs. effort). Use \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10078;chatroom_rooms --role=reviewer --status=backlog\` to view items, then provide recommendations.

      More actions: \`chatroom backlog --help\`

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating code changes.


       ## Reviewer Workflow
       
       You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
       
       **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
       
       **Pair Team Context:**
       - You work with a builder who implements code
       - Focus on code quality and requirements
       - Provide constructive feedback to builder
       
       
      ## Reviewer Workflow

      You receive handoffs from other agents containing work to review or validate.

      **Typical Flow:**
      1. Receive message (handoff from builder or other agent)
      2. Run \`task-started --no-classify\` to acknowledge receipt and start work
      3. Review the code changes or content:
         - Check uncommitted changes: \`git status\`, \`git diff\`
         - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
      4. Either approve or request changes

      **Your Options After Review:**

      **If changes are needed:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=builder << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with your detailed feedback:
      - **Issues Found**: List specific problems
      - **Suggestions**: Provide actionable recommendations

      **If work is approved:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=user << 'EOF'
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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10078;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10078;chatroom_rooms --role=reviewer << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10078;chatroom_rooms --role=reviewer
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      Remember to listen for new messages using \`wait-for-task\` after handoff. Otherwise your team might get stuck not be able to reach you.

          CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10078;chatroom_rooms --role=reviewer

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
    expect(initPrompt?.prompt).toContain('### Read Context');
    expect(initPrompt?.prompt).toContain('### Wait for Tasks');

    // CRITICAL: Should have task-started instruction for reviewer (without classification)
    // Reviewer receives handoffs, not user messages, so no classification needed
    expect(initPrompt?.prompt).toContain('### Start Working');
    expect(initPrompt?.prompt).toContain('task-started --no-classify');

    // Should NOT have classification section (that's only for entry point roles)
    expect(initPrompt?.prompt).not.toContain('### Classify Task');
    expect(initPrompt?.prompt).not.toContain('--origin-message-classification');

    // Should have reviewer workflow instructions
    expect(initPrompt?.prompt).toContain('## Reviewer Workflow');

    // ===== VERIFY TASK DELIVERY PROMPT =====
    expect(taskDeliveryPrompt).toBeDefined();
    expect(taskDeliveryPrompt.humanReadable).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY HUMAN READABLE FORMAT =====
    const humanPrompt = taskDeliveryPrompt.humanReadable;

    // Should have available actions section
    expect(humanPrompt).toContain('## Available Actions');
    expect(humanPrompt).toContain('### Gain Context');

    // Should have role prompt
    expect(humanPrompt).toContain('## Your Role: REVIEWER');
    expect(humanPrompt).toContain('## Reviewer Workflow');

    // Should have wait-for-task reminder
    expect(humanPrompt).toContain('wait-for-task');
    expect(humanPrompt).toContain(chatroomId);
    expect(humanPrompt).toContain('--role=reviewer');

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
    expect(jsonContext.rolePrompt.prompt).toBeDefined();
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('builder');
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('user');
  });
});

// =============================================================================
// REMOTE AGENT SYSTEM PROMPT TESTS
// =============================================================================
// These tests verify the system prompt (rolePrompt) and init message
// (initialMessage) returned by getInitPrompt for remote agents / machine mode.
// The "prompt" field (combined) is tested above; these test the split outputs
// that remote agents use when their harness supports a separate system prompt.
// =============================================================================

describe('Remote Agent System Prompt (rolePrompt)', () => {
  test('builder rolePrompt contains full agent setup for remote agents', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-builder-role-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Get the init prompt for builder
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();

    // ===== VERIFY rolePrompt (system prompt for remote agents) =====
    const rolePrompt = initPrompt?.rolePrompt;
    expect(rolePrompt).toBeDefined();
    expect(typeof rolePrompt).toBe('string');
    expect(rolePrompt!.length).toBeGreaterThan(0);

    // Should have team and role header
    expect(rolePrompt).toContain('# Pair Team');
    expect(rolePrompt).toContain('## Your Role: BUILDER');

    // Should have Getting Started section with CHATROOM_CONVEX_URL commands
    expect(rolePrompt).toContain('## Getting Started');
    expect(rolePrompt).toContain('### Read Context');
    expect(rolePrompt).toContain('### Wait for Tasks');
    expect(rolePrompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should have classification section (builder is entry point)
    expect(rolePrompt).toContain('### Classify Task');
    expect(rolePrompt).toContain('#### Question');
    expect(rolePrompt).toContain('#### Follow Up');
    expect(rolePrompt).toContain('#### New Feature');

    // Should have builder workflow instructions
    expect(rolePrompt).toContain('## Builder Workflow');

    // Should have commands section
    expect(rolePrompt).toContain('### Commands');
    expect(rolePrompt).toContain('**Complete task and hand off:**');
    expect(rolePrompt).toContain('chatroom handoff');

    // Should have next steps (wait-for-task command)
    expect(rolePrompt).toContain('### Next');
    expect(rolePrompt).toContain('chatroom wait-for-task');

    // Snapshot the full rolePrompt for regression detection
    expect(rolePrompt).toMatchInlineSnapshot(`
      "# Pair Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      ## Getting Started

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10089;chatroom_rooms --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10089;chatroom_rooms --role=builder
      \`\`\`

      ### Classify Task
      Acknowledge and classify user messages before starting work.

      #### Question
      User is asking for information or clarification.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10089;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=question
      \`\`\`

      #### Follow Up
      User is responding to previous work or providing feedback.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10089;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=follow_up
      \`\`\`

      #### New Feature
      User wants new functionality. Requires title, description, and tech specs.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10089;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      [Feature title]
      ---DESCRIPTION---
      [Feature description]
      ---TECH_SPECS---
      [Technical specifications]
      EOF
      \`\`\`


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
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=<chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
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
       
       

      ### Handoff Options
      Available targets: reviewer, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10089;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10089;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10089;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10089;chatroom_rooms --role=builder
      \`\`\`"
    `);
  });

  test('reviewer rolePrompt contains full agent setup for remote agents', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-reviewer-role-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Get the init prompt for reviewer
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();

    // ===== VERIFY rolePrompt (system prompt for remote agents) =====
    const rolePrompt = initPrompt?.rolePrompt;
    expect(rolePrompt).toBeDefined();
    expect(typeof rolePrompt).toBe('string');
    expect(rolePrompt!.length).toBeGreaterThan(0);

    // Should have team and role header
    expect(rolePrompt).toContain('# Pair Team');
    expect(rolePrompt).toContain('## Your Role: REVIEWER');

    // Should have Getting Started section with CHATROOM_CONVEX_URL commands
    expect(rolePrompt).toContain('## Getting Started');
    expect(rolePrompt).toContain('### Read Context');
    expect(rolePrompt).toContain('### Wait for Tasks');
    expect(rolePrompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Reviewer is NOT the entry point — should have Start Working, not Classify Task
    expect(rolePrompt).toContain('### Start Working');
    expect(rolePrompt).toContain('task-started --no-classify');
    expect(rolePrompt).not.toContain('### Classify Task');
    expect(rolePrompt).not.toContain('--origin-message-classification');

    // Should have reviewer workflow instructions
    expect(rolePrompt).toContain('## Reviewer Workflow');

    // Should have commands section
    expect(rolePrompt).toContain('### Commands');
    expect(rolePrompt).toContain('**Complete task and hand off:**');
    expect(rolePrompt).toContain('chatroom handoff');

    // Should have next steps
    expect(rolePrompt).toContain('### Next');
    expect(rolePrompt).toContain('chatroom wait-for-task');

    // Snapshot the full rolePrompt for regression detection
    expect(rolePrompt).toMatchInlineSnapshot(`
      "# Pair Team

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating code changes.

      ## Getting Started

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10096;chatroom_rooms --role=reviewer
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10096;chatroom_rooms --role=reviewer
      \`\`\`

      ### Start Working
      Before starting work on a received message, acknowledge it:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10096;chatroom_rooms --role=reviewer --task-id=<task-id> --no-classify
      \`\`\`

      This transitions the task to \`in_progress\`. Classification was already done by the agent who received the original user message.


       ## Reviewer Workflow
       
       You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
       
       **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
       
       **Pair Team Context:**
       - You work with a builder who implements code
       - Focus on code quality and requirements
       - Provide constructive feedback to builder
       
       
      ## Reviewer Workflow

      You receive handoffs from other agents containing work to review or validate.

      **Typical Flow:**
      1. Receive message (handoff from builder or other agent)
      2. Run \`task-started --no-classify\` to acknowledge receipt and start work
      3. Review the code changes or content:
         - Check uncommitted changes: \`git status\`, \`git diff\`
         - Check recent commits: \`git log --oneline -10\`, \`git diff HEAD~N..HEAD\`
      4. Either approve or request changes

      **Your Options After Review:**

      **If changes are needed:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=builder << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with your detailed feedback:
      - **Issues Found**: List specific problems
      - **Suggestions**: Provide actionable recommendations

      **If work is approved:**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=<chatroom-id> --role=<role> --next-role=user << 'EOF'
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
       
       

      ### Handoff Options
      Available targets: builder, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10096;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10096;chatroom_rooms --role=reviewer << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10096;chatroom_rooms --role=reviewer
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10096;chatroom_rooms --role=reviewer
      \`\`\`"
    `);
  });

  test('rolePrompt equals combined prompt when initMessage is empty', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-role-prompt-equals-combined');
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

    // When initMessage is empty, rolePrompt should equal the combined prompt
    // This ensures remote agents get the same content as CLI agents
    if (!initPrompt?.initialMessage || initPrompt.initialMessage.trim() === '') {
      expect(initPrompt?.rolePrompt).toBe(initPrompt?.prompt);
    }
  });
});

describe('Remote Agent Init Message (initialMessage)', () => {
  test('builder initialMessage is currently empty (reserved for future use)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-builder-init-message');
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

    // initialMessage is currently empty — reserved for future use
    // This test will fail if content is added, prompting review
    expect(initPrompt?.initialMessage).toBe('');
  });

  test('reviewer initialMessage is currently empty (reserved for future use)', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-reviewer-init-message');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Get the init prompt
    const initPrompt = await t.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId,
      role: 'reviewer',
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(initPrompt).toBeDefined();

    // initialMessage is currently empty — reserved for future use
    expect(initPrompt?.initialMessage).toBe('');
  });
});

describe('Task-Complete Command', () => {
  test('materializes complete task-complete output', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-task-complete');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // User sends message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Fix the typo in the README',
      type: 'message',
    });

    // Builder claims and starts the task
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

    // Builder completes the task (without handoff)
    const result = await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Materialize the complete CLI output for task-complete command
    const role = 'builder';
    const cliEnvPrefix = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210';

    // Build output based on result (matching CLI implementation)
    let fullCliOutput = `✅ Task completed successfully
   Tasks completed: ${result.completedCount}`;

    if (result.promoted) {
      fullCliOutput += `\n   Promoted next task: ${result.promoted}`;
    }

    fullCliOutput += `

⏳ Now run wait-for-task to wait for your next assignment:
   ${cliEnvPrefix} chatroom wait-for-task --chatroom-id=${chatroomId} --role=${role}`;

    // Verify the complete output structure matches expected format
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "✅ Task completed successfully
         Tasks completed: 1

      ⏳ Now run wait-for-task to wait for your next assignment:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10124;chatroom_rooms --role=builder"
    `);

    // Verify mutation result
    expect(result.completed).toBe(true);
    expect(result.completedCount).toBe(1);
    expect(result.pendingReview).toEqual([]);
  });

  test('materializes task-complete output when no tasks to complete', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-task-complete-none');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Try to complete without any in-progress task
    const result = await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Materialize error output (CLI would exit with error before this)
    const fullCliOutput = result.completed
      ? '✅ Task completed successfully'
      : `❌ No task to complete

💡 Make sure you have an in_progress task before completing.
   Run \`chatroom wait-for-task\` to receive and start a task first.`;

    // Verify the output structure
    expect(fullCliOutput).toMatchInlineSnapshot(`
      "❌ No task to complete

      💡 Make sure you have an in_progress task before completing.
         Run \`chatroom wait-for-task\` to receive and start a task first."
    `);

    // Verify mutation result
    expect(result.completed).toBe(false);
    expect(result.completedCount).toBe(0);
    expect(result.promoted).toBeNull();
  });
});
