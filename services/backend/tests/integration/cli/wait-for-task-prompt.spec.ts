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
import { getWaitForTaskGuidance, getWaitForTaskReminder } from '../../../prompts/base/cli/index';
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
    // Init section (CLI-generated) + Task delivery section (backend-generated via fullCliOutput)

    const role = 'builder';

    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "${role}"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

${getWaitForTaskGuidance()}

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

      Your primary directive: Stay available to respond to user and team requests.

      ⚠️  CRITICAL: Run wait-for-task in the FOREGROUND

      Two requirements:

      1. **Shell foreground** - Never use \`&\`, \`nohup\`, or backgrounding
         • Must run directly in your active terminal
         • Backgrounded processes cannot receive tasks

      2. **Blocking execution** - Wait for command completion
         • Do not respond to user or perform other work while running
         • Only proceed after the command exits (signal or task received)

      ⚠️  WHEN THE PROCESS IS TERMINATED OR TIMED OUT
      • Your harness may kill long-running commands after a set duration
      • When the command terminates unexpectedly:
        1. Do you have urgent pending work?
        2. Without wait-for-task, your team cannot reach you
        3. If no urgent work, reconnect immediately

      📋 BACKLOG TASKS
        chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
        chatroom backlog --help

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      ## Getting Started

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=10002;chatroom_rooms --role=builder --type=<remote|custom>
      \`\`\`

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

      **Context Rule:** When a new commit is expected, set a new context first to keep the conversation focused. Only the entry point role can set contexts:
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=10002;chatroom_rooms --role=builder << 'EOF'
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
      Task ID: 10007;chatroom_tasks
      Message ID: 10006;chatroom_messages

      📋 NEXT STEPS
      ============================================================
      To acknowledge and classify this message, run:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10007;chatroom_tasks --origin-message-classification=<type>

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10007;chatroom_tasks --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      Classification types: question, new_feature, follow_up
      ============================================================

      ============================================================
      📍 PINNED - Work on this immediately
      ============================================================

      ## User Message
      <user-message>
      Can we add a backlog section to the available actions? Keep it concise and follow current format.
      </user-message>

      ## Task
      Can we add a backlog section to the available actions? Keep it concise and follow current format.

      ## Attached Backlog (1)
      - [BACKLOG_ACKNOWLEDGED] Fix: Agent lacks knowledge of backlog listing

      Add backlog section to wait-for-task

      ============================================================
      📋 PROCESS
      ============================================================

      1. If code changes / commits are expected, set a new context:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=10002;chatroom_rooms --role=builder << 'EOF'
      <summary of current focus>
      EOF

      2. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10002;chatroom_rooms --role=builder --task-id=10007;chatroom_tasks --origin-message-classification=follow_up

      3. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10002;chatroom_rooms --role=builder
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=10002;chatroom_rooms --role=builder --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=10002;chatroom_rooms --role=builder
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10002;chatroom_rooms --role=builder --status=backlog

      4. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10002;chatroom_rooms --role=builder --next-role=<target>
         Available targets: reviewer, user

      5. Resume listening:
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
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY FULL CLI OUTPUT FORMAT =====
    const fullOutput = taskDeliveryPrompt.fullCliOutput;

    // Should have consolidated PROCESS section with inline guidance
    expect(fullOutput).toContain('📋 PROCESS');
    expect(fullOutput).toContain('Available commands:');
    expect(fullOutput).toContain('Read context:');
    expect(fullOutput).toContain('List messages:');
    expect(fullOutput).toContain('View code changes:');
    expect(fullOutput).toContain('Complete task (no handoff):');
    expect(fullOutput).toContain('View backlog:');
    expect(fullOutput).toContain(`chatroom backlog list --chatroom-id=${chatroomId}`);

    // Should have handoff targets and wait-for-task in PROCESS
    expect(fullOutput).toContain('Hand off when complete:');
    expect(fullOutput).toContain('Resume listening:');
    expect(fullOutput).toContain('wait-for-task');
    expect(fullOutput).toContain(chatroomId);
    expect(fullOutput).toContain('--role=builder');

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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10024;chatroom_rooms --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Message ID: 10027;chatroom_messages"
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
      1. Send a progress update: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10031;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF\`
      2. Answer the user's question
      3. When done, hand off directly to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10031;chatroom_rooms --role=builder --next-role=user << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Message ID: 10034;chatroom_messages"
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
      Message ID: 10041;chatroom_messages"
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
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10045;chatroom_rooms --role=builder"
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
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10054;chatroom_rooms --role=builder"
    `);

    // Verify mutation result
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.completedTaskIds.length).toBeGreaterThan(0);
    expect(result.newTaskId).toBeNull(); // No task for user
  });
});

describe('Wait-for-Task Error Prompts', () => {
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
    // Init section (CLI-generated) + Task delivery section (backend-generated via fullCliOutput)

    const role = 'reviewer';

    const fullCliMessage = `
[TIMESTAMP] ⏳ Connecting to chatroom as "${role}"...
[TIMESTAMP] ✅ Connected. Waiting for task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

${getWaitForTaskGuidance()}

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

      Your primary directive: Stay available to respond to user and team requests.

      ⚠️  CRITICAL: Run wait-for-task in the FOREGROUND

      Two requirements:

      1. **Shell foreground** - Never use \`&\`, \`nohup\`, or backgrounding
         • Must run directly in your active terminal
         • Backgrounded processes cannot receive tasks

      2. **Blocking execution** - Wait for command completion
         • Do not respond to user or perform other work while running
         • Only proceed after the command exits (signal or task received)

      ⚠️  WHEN THE PROCESS IS TERMINATED OR TIMED OUT
      • Your harness may kill long-running commands after a set duration
      • When the command terminates unexpectedly:
        1. Do you have urgent pending work?
        2. Without wait-for-task, your team cannot reach you
        3. If no urgent work, reconnect immediately

      📋 BACKLOG TASKS
        chatroom backlog list --chatroom-id=<chatroomId> --role=<role> --status=backlog
        chatroom backlog --help

      ══════════════════════════════════════════════════

      # Pair Team

      ## Your Role: REVIEWER

      You are the quality guardian responsible for reviewing and validating code changes.

      ## Getting Started

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=10062;chatroom_rooms --role=reviewer --type=<remote|custom>
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10062;chatroom_rooms --role=reviewer
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10062;chatroom_rooms --role=reviewer
      \`\`\`

      ### Start Working
      Before starting work on a received message, acknowledge it:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10062;chatroom_rooms --role=reviewer --task-id=<task-id> --no-classify
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

       

      ### Handoff Options
      Available targets: builder, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10062;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10062;chatroom_rooms --role=reviewer << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10062;chatroom_rooms --role=reviewer
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10062;chatroom_rooms --role=reviewer
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 Task received!

      ============================================================
      🆔 TASK INFORMATION
      ============================================================
      Task ID: 10068;chatroom_tasks
      Message ID: 10067;chatroom_messages

      📋 NEXT STEPS
      ============================================================
      Task handed off from builder.
      The original user message was already classified - you can start work immediately.
      ============================================================

      ============================================================
      📍 PINNED - Work on this immediately
      ============================================================

      ## User Message
      <user-message>
      Add dark mode toggle to the application
      </user-message>

      ## Task
      Implemented dark mode toggle. Please review.

      Changes:
      - Added ThemeProvider context
      - Created toggle component in Settings
      - Applied CSS variables for theming

      Testing: Toggle in settings switches between light/dark modes

      Classification: NEW_FEATURE

      ============================================================
      📋 PROCESS
      ============================================================

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10062;chatroom_rooms --role=reviewer --task-id=10068;chatroom_tasks --no-classify

      2. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10062;chatroom_rooms --role=reviewer
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=10062;chatroom_rooms --role=reviewer --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=10062;chatroom_rooms --role=reviewer
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=10062;chatroom_rooms --role=reviewer --status=backlog

      3. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10062;chatroom_rooms --role=reviewer --next-role=<target>
         Available targets: builder, user

      4. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10062;chatroom_rooms --role=reviewer

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
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY FULL CLI OUTPUT FORMAT =====
    const fullOutput = taskDeliveryPrompt.fullCliOutput;

    // Should have consolidated PROCESS section with inline guidance
    expect(fullOutput).toContain('📋 PROCESS');
    expect(fullOutput).toContain('Available commands:');
    expect(fullOutput).toContain('Read context:');
    expect(fullOutput).toContain('List messages:');

    // Should have handoff targets and wait-for-task in PROCESS
    expect(fullOutput).toContain('Hand off when complete:');
    expect(fullOutput).toContain('Resume listening:');
    expect(fullOutput).toContain('wait-for-task');
    expect(fullOutput).toContain(chatroomId);
    expect(fullOutput).toContain('--role=reviewer');

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

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=10071;chatroom_rooms --role=builder --type=<remote|custom>
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10071;chatroom_rooms --role=builder
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10071;chatroom_rooms --role=builder
      \`\`\`

      ### Classify Task
      Acknowledge and classify user messages before starting work.

      #### Question
      User is asking for information or clarification.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10071;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=question
      \`\`\`

      #### Follow Up
      User is responding to previous work or providing feedback.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10071;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=follow_up
      \`\`\`

      #### New Feature
      User wants new functionality. Requires title, description, and tech specs.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10071;chatroom_rooms --role=builder --task-id=<task-id> --origin-message-classification=new_feature << 'EOF'
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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=10071;chatroom_rooms --role=builder << 'EOF'
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

       

      ### Handoff Options
      Available targets: reviewer, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10071;chatroom_rooms --role=builder --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10071;chatroom_rooms --role=builder << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10071;chatroom_rooms --role=builder
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10071;chatroom_rooms --role=builder
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

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id=10076;chatroom_rooms --role=reviewer --type=<remote|custom>
      \`\`\`

      ### Read Context
      View the conversation history and pending tasks for your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=10076;chatroom_rooms --role=reviewer
      \`\`\`

      ### Wait for Tasks
      Listen for incoming tasks assigned to your role.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10076;chatroom_rooms --role=reviewer
      \`\`\`

      ### Start Working
      Before starting work on a received message, acknowledge it:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=10076;chatroom_rooms --role=reviewer --task-id=<task-id> --no-classify
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

       

      ### Handoff Options
      Available targets: builder, user

      ### Commands

      **Complete task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=10076;chatroom_rooms --role=reviewer --next-role=<target> << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      Replace \`[Your message here]\` with:
      - **Summary**: Brief description of what was done
      - **Changes Made**: Key changes (bullets)
      - **Testing**: How to verify the work

      **Report progress on current task:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=10076;chatroom_rooms --role=reviewer << 'EOF'
      [Your progress message here]
      EOF
      \`\`\`

      Keep the team informed: Send \`report-progress\` updates at milestones or when blocked. Progress appears inline with the task.

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10076;chatroom_rooms --role=reviewer
      \`\`\`

      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10076;chatroom_rooms --role=reviewer
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
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=10096;chatroom_rooms --role=builder"
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

describe('Wait-for-Task Recent Improvements', () => {
  test('guidance text contains updated content (no longer references timeouts)', () => {
    const guidance = getWaitForTaskGuidance();
    const reminder = getWaitForTaskReminder();

    // Updated guidance should contain the new sections
    expect(guidance).toContain('STAYING CONNECTED TO YOUR TEAM');
    expect(guidance).toContain('CRITICAL: Run wait-for-task in the FOREGROUND');
    expect(guidance).toContain('WHEN THE PROCESS IS TERMINATED OR TIMED OUT');
    expect(guidance).toContain('BACKLOG TASKS');

    // Should NOT contain the old timeout-specific language
    expect(guidance).not.toContain('HOW WAIT-FOR-TASK WORKS');
    expect(guidance).not.toContain('The command may timeout before a task arrives');

    // Reminder should be a single-line reminder
    expect(reminder).toContain('Message availability is critical');
    expect(reminder).toContain('wait-for-task');
  });

  test('attached backlog tasks appear in task delivery prompt JSON', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-attached-backlog-in-prompt');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog task
    const backlogResult = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Recovery of acknowledged tasks: implement 1-min grace period',
      createdBy: 'user',
      isBacklog: true,
    });
    const backlogTaskId = backlogResult.taskId;

    // User sends message with the backlog task attached
    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can we work on this task?',
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

    // Get the task delivery prompt
    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      messageId: userMessageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Verify attached backlog tasks appear in the prompt JSON
    const originMessage = taskDeliveryPrompt.json.contextWindow.originMessage;
    expect(originMessage).toBeDefined();
    expect(originMessage?.attachedTasks).toBeDefined();
    expect(originMessage?.attachedTasks?.length).toBe(1);

    const attachedTask = originMessage?.attachedTasks?.[0];
    expect(attachedTask?.content).toBe(
      'Recovery of acknowledged tasks: implement 1-min grace period'
    );
    expect(attachedTask?.status).toBeDefined();

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
    expect(pendingResult.length).toBe(1);
    expect(pendingResult[0].task.status).toBe('pending');

    // Builder claims the task (transitions to acknowledged)
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Verify acknowledged task is STILL returned by getPendingTasksForRole
    const acknowledgedResult = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(acknowledgedResult.length).toBe(1);
    expect(acknowledgedResult[0].task.status).toBe('acknowledged');

    // Verify the message is included with the task
    expect(acknowledgedResult[0].message).toBeDefined();
    expect(acknowledgedResult[0].message?.content).toBe('Please implement the dark mode feature');
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
    expect(prompt).toContain('chatroom wait-for-task');
    expect(prompt).toContain('chatroom context read');

    // Init prompt should contain the wait-for-task reminder
    expect(prompt).toContain(getWaitForTaskReminder());
  });
});
