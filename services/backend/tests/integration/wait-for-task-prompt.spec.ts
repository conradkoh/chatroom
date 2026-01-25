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

    // ===== OUTPUT COMPLETE CLI MESSAGE FOR REVIEW =====
    // This materializes the exact message structure sent from server to wait-for-task command

    const taskId = startResult.taskId;
    const messageId = userMessageId;
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;
    const existingClassification = originMessage?.classification;

    const fullCliMessage = `
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
  chatroom backlog list <chatroomId> --role=<role> --status=backlog
More actions: \`chatroom backlog --help\`

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════


============================================================
🆔 TASK INFORMATION
============================================================
Task ID: ${taskId}
Message ID: ${messageId}

📋 NEXT STEPS
============================================================
To acknowledge and classify this message, run:

CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started ${chatroomId} --role=builder --task-id=${taskId} --origin-message-classification=<type>

📝 Classification Requirements:
   • question: No additional fields required
   • follow_up: No additional fields required
   • new_feature: REQUIRES --title, --description, --tech-specs

💡 Example for new_feature:
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started ${chatroomId} --role=builder --task-id=${taskId} --origin-message-classification=new_feature << 'EOF'
---TITLE---
<title>
---DESCRIPTION---
<description>
---TECH_SPECS---
<tech-specs>
EOF

Classification types: question, new_feature, follow_up
============================================================

## 📍 Pinned
### Primary User Directive
<user-message>
${originMessage?.content || 'NO CONTENT'}
${
  originMessage?.attachedTasks && originMessage.attachedTasks.length > 0
    ? `
ATTACHED BACKLOG (${originMessage.attachedTasks.length})
${originMessage.attachedTasks.map((t) => t.content).join('\n\n')}`
    : ''
}
</user-message>

### Inferred Task
${existingClassification ? `Classification: ${existingClassification}` : `Not created yet. Run \`chatroom task-started …\` to specify task.`}
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
        chatroom backlog list <chatroomId> --role=<role> --status=backlog
      More actions: \`chatroom backlog --help\`

      ══════════════════════════════════════════════════

      # Pair Team Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      ## Getting Started

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read 10002;chatroom_rooms --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task 10002;chatroom_rooms --role=builder
      \`\`\`

      ### Classify Task
      Acknowledge and classify user messages before starting work.

      #### Question
      User is asking for information or clarification.

      \`\`\`bash
      chatroom task-started 10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=question
      \`\`\`

      #### Follow Up
      User is responding to previous work or providing feedback.

      \`\`\`bash
      chatroom task-started 10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=follow_up
      \`\`\`

      #### New Feature
      User wants new functionality. Requires title, description, and tech specs.

      \`\`\`bash
      chatroom task-started 10002;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=new_feature << 'EOF'
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
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
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
       
       

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff 10002;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress 10002;chatroom_rooms --role=builder --message="Working on tests..."
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task 10002;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task 10002;chatroom_rooms --role=builder
      \`\`\`

      ══════════════════════════════════════════════════


      ============================================================
      🆔 TASK INFORMATION
      ============================================================
      Task ID: 10009;chatroom_tasks
      Message ID: 10008;chatroom_messages

      📋 NEXT STEPS
      ============================================================
      To acknowledge and classify this message, run:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started 10002;chatroom_rooms --role=builder --task-id=10009;chatroom_tasks --origin-message-classification=<type>

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started 10002;chatroom_rooms --role=builder --task-id=10009;chatroom_tasks --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      Classification types: question, new_feature, follow_up
      ============================================================

      ## 📍 Pinned
      ### Primary User Directive
      <user-message>
      Can we add a backlog section to the available actions? Keep it concise and follow current format.

      ATTACHED BACKLOG (1)
      Fix: Agent lacks knowledge of backlog listing

      Add backlog section to wait-for-task
      </user-message>

      ### Inferred Task
      Not created yet. Run \`chatroom task-started …\` to specify task.
      ============================================================

      ## Available Actions

      ### Gain Context
      View the latest relevant chat history. Use when starting a new session or when context is unclear.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read 10002;chatroom_rooms --role=builder
      \`\`\`

      ### List Messages
      Query specific messages with filters.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list 10002;chatroom_rooms --role=builder --sender-role=user --limit=5 --full
      \`\`\`

      ### View Code Changes
      Check recent commits for implementation context.

      \`\`\`bash
      git log --oneline -10
      \`\`\`

      ### Complete Task
      Mark current task as complete without handing off to another role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete 10002;chatroom_rooms --role=builder
      \`\`\`

      ### Backlog
      The chatroom has a task backlog. View items with:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list 10002;chatroom_rooms --role=builder --status=backlog
      \`\`\`

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
      1. First run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>\` to classify the original message (question, new_feature, or follow_up)
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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff 10002;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress 10002;chatroom_rooms --role=builder --message="Working on tests..."
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task 10002;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      Remember to listen for new messages using \`wait-for-task\` after handoff. Otherwise your team might get stuck not be able to reach you.

          chatroom wait-for-task 10002;chatroom_rooms --role=builder

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
      featureTitle: 'Dark Mode Toggle',
      featureDescription: 'Add a toggle in settings for dark/light mode',
      featureTechSpecs: 'Use React Context + CSS variables',
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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff 10030;chatroom_rooms --role=builder --next-role=reviewer << 'EOF'
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
      1. Send a progress update: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress 10039;chatroom_rooms --role=builder --message="Researching..."\`
      2. Answer the user's question
      3. When done, hand off directly to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff 10039;chatroom_rooms --role=builder --next-role=user << 'EOF'
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
