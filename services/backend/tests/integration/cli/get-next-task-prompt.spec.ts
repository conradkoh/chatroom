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
 * Helper to create a Duo team chatroom
 */
async function createDuoTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
[TIMESTAMP] ✅ Connected. Blocking until the next user or team message resolves as a chatroom task...

<!-- REFERENCE: Agent Initialization

══════════════════════════════════════════════════
📋 AGENT INITIALIZATION PROMPT
══════════════════════════════════════════════════

${getNextTaskGuidance()}

══════════════════════════════════════════════════

${initPrompt?.prompt || 'NO INIT PROMPT GENERATED'}

══════════════════════════════════════════════════
-->

[TIMESTAMP] 📨 CHATROOM TASK received

${taskDeliveryPrompt.fullCliOutput}
`;

    // Verify the complete message structure matches expected format
    // The inline snapshot will materialize the full message for human review in the test file
    expect(fullCliMessage).toMatchInlineSnapshot(`
      "
      [TIMESTAMP] ⏳ Connecting to chatroom as "builder"...
      [TIMESTAMP] ✅ Connected. Blocking until the next user or team message resolves as a chatroom task...

      <!-- REFERENCE: Agent Initialization

      ══════════════════════════════════════════════════
      📋 AGENT INITIALIZATION PROMPT
      ══════════════════════════════════════════════════

      🔗 STAYING CONNECTED TO YOUR TEAM

      Your primary directive: Stay available to receive chatroom tasks from your team.

      When the user or team is ready, your blocking \`get-next-task\` resolves and delivers their message as the next chatroom task. That message is the source of truth for what to do—numbered next-steps in task delivery are typical role patterns, not a rigid script.

      The harness delivers the next chatroom task only through a single foreground \`get-next-task\` that blocks as a tool call. After completing work and handing off, that blocking listener is what keeps you connected to your team.

      Exactly one active waiter should own task delivery at a time. Additional or backgrounded \`get-next-task\` sessions can acknowledge incoming tasks early, causing grace-period conflicts where your active agent receives nothing.

      After interruption or restart: complete any in-progress work, then restore a single foreground blocking \`get-next-task\` so chatroom tasks can arrive again.

      ══════════════════════════════════════════════════

      # Duo Team

      ## Your Role: BUILDER

      You are the implementer responsible for writing code and building solutions.

      # Glossary

      - \`session\`
          - The entire agent invocation (one harness turn) — from harness startup to shutdown. A session spans many chatroom tasks. Completing a chatroom task (handoff) does NOT end the session. Always run \`get-next-task\` after a handoff to stay in the session.

      - \`chatroom-task\`
          - One discrete unit of work delivered by \`get-next-task\`. A chatroom task begins when the agent receives it and ends when the agent runs \`handoff\`. Completing a chatroom task only closes Level B — the session (Level A) continues.

      - \`listen-loop\`
          - The mandatory foreground loop: after every \`handoff\`, run \`get-next-task\` to listen for the next chatroom task. Running \`get-next-task\` in the background or skipping it breaks the listen loop and disconnects the agent.

      - \`backlog\` (1 skill available)
          - The list of work items the team intends to do but has not yet started. Agents use the \`chatroom backlog\` CLI command group to manage backlog items.

      - \`attachments\`
          - Message attachment types (task, backlog, message, snippet) delivered in agent prompts as XML when users attach context to messages.

      - \`code-review\` (1 skill available)
          - Eight-pillar code review framework: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, and dead code elimination. Covers AI-generated code review with focus on maintainability and tech debt prevention.

      - \`structural-decisions\`
          - Meta-level architectural choices that persist in the codebase and influence consistency: folder structure, file naming, interface definitions, and key abstraction names/locations (e.g., Repository/Service layers).

      # Skills

      Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom skill list --chatroom-id=<id> --role=<role>\` to list all available skills.

      ## When to Activate Skills

      **Proactively activate skills** when your task matches their purpose:
      - **backlog**: Full backlog command reference: list/add/update, scoring, completion, close, export/import, and workflow guides.
      - **code-review**: Use this skill when reviewing, auditing, or giving feedback on code. Covers ten pillars: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, dead code elimination, incomplete implementations, and hallucinated content.

      Don't wait for the user to ask — proactively activate the skill that matches the task.

      ## Two-Level Model: Session vs Chatroom Task

      | Level | Name | Scope | Ends when |
      |-------|------|-------|-----------|
      | **A** | **Session** (harness turn) | The entire agent invocation — from startup to shutdown | You deliberately shut down or the harness exits |
      | **B** | **Chatroom task** | One discrete unit of work delivered by \`get-next-task\` | You run \`handoff\` to pass work to the next role |

      **Completing Level B does NOT end Level A.**
      After every \`handoff\`, you must run \`get-next-task\` again to stay in the session and receive the next chatroom task.

      ### Session Lifecycle

      A session starts when your harness launches you and ends only when the harness shuts down (or you explicitly stop).
      Within a session, you process many chatroom tasks sequentially:

      \`get-next-task\` → do work → \`handoff\` → \`get-next-task\` → do work → \`handoff\` → …

      Never exit or stop after a handoff — that closes the session (Level A) before the user is done with you.

      ### Common Mistakes

      ❌ **Wrong:** Run \`handoff\`, then stop or wait for the user to re-invoke you.
      ✅ **Right:** Run \`handoff\`, then immediately run \`get-next-task\` in the foreground.

      ❌ **Wrong:** Think "I finished the task, I'm done."
      ✅ **Right:** Think "I finished this chatroom task (Level B). The session (Level A) continues — run \`get-next-task\`."

      ❌ **Wrong:** Run \`get-next-task\` in the background or skip it.
      ✅ **Right:** \`get-next-task\` must run in the **foreground** so the harness can deliver the next chatroom task.

      ## Getting Started

      ### Workflow Loop

      \`\`\`mermaid
      flowchart LR
          A([Start]) --> B[register-agent]
          B --> C[get-next-task
      chatroom task delivery]
          C --> D[Do Work]
          D --> E[handoff]
          E --> C
      \`\`\`

      ### Task delivery and activity

      When \`get-next-task\` delivers a chatroom task, the **full task content is included in the output**. Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.

      ⚠️ Remember your two-level model: completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, you must run \`get-next-task\` again to continue the session.

      ### Context Recovery (after compaction/summarization)

      NOTE: If you are an agent that has undergone compaction or summarization, run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="000000000000010002chatroom_rooms" --role="builder"
      to reload your full system and role prompt. Then run:
        CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="builder"
      to see your current chatroom task context.

      CLI harnesses do not support in-session compaction. After context is lost, the daemon performs a hard restart — you must run \`get-next-task\` again to rejoin the chatroom.

      ### Register Agent
      Register your agent type before starting work.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom register-agent --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --type=<remote|custom>
      \`\`\`

      ### Get Next Task
      Listen for incoming tasks assigned to your role. A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer intent from the message rather than following numbered next-steps blindly.

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="000000000000010002chatroom_rooms" --role="builder"
      \`\`\`

      **This loop never ends.** A session (Level A) processes many chatroom tasks (Level B). Each handoff completes Level B — \`get-next-task\` continues Level A. Do not stop or exit after a handoff.


      ### Start working

      Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.

      **Context Rule:** Set a new context for every user message by default — skip ONLY when the message is clearly a follow-up of the current chatroom task. **Before running \`context new\`, run \`context read\` — if the pinned context already uses the same \`--trigger-message-id\` as this task's Origin Message ID, do NOT create another context** (avoids duplicate timeline dividers). Only the entry point role can set contexts:
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --trigger-message-id="<userMessageId>" << 'CHATROOM_CONTEXT_END'
      <summary of current focus>
      CHATROOM_CONTEXT_END
      \`\`\`
      REQUIRED: All context content MUST conform to the template. Run \`chatroom context view-template\` and follow it exactly. \`--trigger-message-id\` must be a **message** ID (from Origin Message ID in the task header), NOT the Task ID.


       **Duo Team Context:**
       - You work with a planner who coordinates work and communicates with the user
       - You do NOT communicate directly with the user — hand off to the planner instead
       - Focus on implementation; the planner handles user communication and delivery
       - After completing work, hand off back to planner
       - **NEVER hand off directly to \`user\`** — always go through the planner
       
       
      ## Builder Operating Model

      Completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, run \`get-next-task\` to continue.

      You are responsible for implementing code changes based on requirements.

      **Typical Flow:**

      \`\`\`mermaid
      flowchart TD
          A([Start]) --> B[Receive chatroom task]
          B --> D[Implement changes]
          D --> E[Commit work]
          E --> F{Code changes?}
          F -->|yes| G[Hand off to **planner**]
          F -->|no| H[Hand off to **planner**]
      \`\`\`

      **Handoff Rules:**
      - **After code changes** → Hand off to \`planner\`
      - **For simple questions** → Can hand off directly to \`planner\`
        ⚠️ If \`planner\` is the user: the user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a complete, self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.

      **Implementation Guidelines:**
      - Write clean, maintainable, well-documented code
      - Follow established patterns and best practices from the codebase
      - Handle edge cases and error scenarios
      - Commit work with descriptive, atomic commit messages

       

      ### Handoff Options
      Available targets: planner, user

      ### Commands

      **Complete chatroom task and hand off:**

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --next-role="<target>" << 'CHATROOM_HANDOFF_END'
      ---MESSAGE---
      [Your message here]
      CHATROOM_HANDOFF_END
      \`\`\`

      Fill in the message using the matching template from \`<handoff-templates>\` in your task delivery output. Replace \`[Your message here]\` with that template content. The closing line must be exactly \`CHATROOM_HANDOFF_END\` (not \`EOF\`).

      **Continue receiving messages after \`handoff\`:**
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="000000000000010002chatroom_rooms" --role="builder"
      \`\`\`

      A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer what to do from the message, not only from numbered next-steps. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.

      **Reference commands:**
      - List recent messages: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --sender-role=user --limit=5 --full\`
      - Git log: \`git log --oneline -10\`

      **Recovery commands** (only needed after compaction/restart):
      - Reload system prompt: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`
      - Reload role guidance: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`
      - Read current chatroom task context: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`

      ### Next

      Run:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="000000000000010002chatroom_rooms" --role="builder"
      \`\`\`

      ══════════════════════════════════════════════════
      -->

      [TIMESTAMP] 📨 CHATROOM TASK received

      <task task-id="000000000000010007chatroom_tasks" origin-message-id="000000000010006chatroom_messages" sender="user">
      <context>
        <hint>(read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`</hint>
      </context>

      <attachments>
        <attachment type="backlog" backlog-item-id="0000000000010005chatroom_backlog">
          <content>
      Fix: Agent lacks knowledge of backlog listing

      Add backlog section to get-next-task
          </content>
          <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --backlog-item-id=0000000000010005chatroom_backlog</hint>
        </attachment>
      </attachments>
      <message sender="user" message-id="000000000010006chatroom_messages">
      <message-content>
      Can we add a backlog section to the available actions? Keep it concise and follow current format.
      </message-content>
      </message>
      <intake-note>
      Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.
      </intake-note>
      </task>

      <next-steps>
      1. Work on the task above.
      2. **When complete, you MUST run the handoff command** — this completes your work and delivers it to \`user\` (task from \`user\`):

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --next-role="user" << 'CHATROOM_HANDOFF_END'
      ---MESSAGE---
      [Your message here]
      CHATROOM_HANDOFF_END
      \`\`\`

      Fill in the message using the matching template in \`<handoff-templates>\` below. Replace \`[Your message here]\` with the template content. The closing line must be exactly \`CHATROOM_HANDOFF_END\` (not \`EOF\`). **Do not end your turn without running handoff.**

      </next-steps>

      <handoff-templates>
      Use these structures when handing off.

      ### Handoff to \`planner\`
      ---

      ⚠️ **CRITICAL — Recipient visibility**

      The \`planner\` agent **only** receives the text inside your \`handoff --next-role="planner"\` command.

      They **cannot** see:
      - Anything you write in this agent session
      - Progress reports
      - Tool output

      Put your **complete** deliverable in the handoff message — not in session text.

      ---

      **Handoff Template (Builder → Planner)** — paste into the handoff message. Fill in EVERY section below. If a section does not apply, write \`Not Applicable\` (do not delete the section):

      \`\`\`markdown
      ## Summary
      <what was implemented or attempted, in plain terms>

      ## Template Disclosure Confirmation
      - [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
      - [ ] I confirm that I've read and followed the role guidance before starting any work
      <!-- Role guidance is static for your role and does not change between tasks. Run once if needed: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\`. You do not need to re-read it on every task if you have already read it once. -->

      ## Proof of Principle
      <!-- Demonstrate adherence to:
      - Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
      - Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
      - No Revisit: implemented in a way so the user does not have to revisit this implementation again.
      - Leave It Better: leave the code in a slightly better state than before when touching files.
      -->
      <how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

      ## Proof of Completion
      - [ ] I confirm that the goal and acceptance criteria from the planner’s delegation brief have been met
      <!-- Reference the ## Goal and ## Requirements (acceptance criteria) sections from the planner handoff you received. State the delegation goal and confirm it was achieved. -->
      <!-- File references (clickable in workspace UI): use repo-relative paths with a file extension — e.g. \`apps/webapp/src/modules/chatroom/foo.ts\` or [apps/webapp/src/foo.ts](apps/webapp/src/foo.ts). Avoid absolute paths, file:// prefixes, and paths without / or extension. -->
      - \`apps/webapp/src/path/to/file.ts\` — <what changed and why>
      <evidence the goal was met — list every file you modified>

      ## Code Change Verification
      - [ ] I confirm that I have run typecheck and tests for the project (only required if code changes were made)

      ## Blockers / questions
      <anything needing planner decision, or "Not Applicable">

      ## Notes for review
      <specific areas for planner to check, or "Not Applicable">
      \`\`\`

      </handoff-templates>

      <handoffs>
      Other handoff targets (if you need a different recipient than step 2):

      **planner**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --next-role="planner" << 'CHATROOM_HANDOFF_END'
      ---MESSAGE---
      [Your message here]
      CHATROOM_HANDOFF_END
      \`\`\`

      **user**
      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="000000000000010002chatroom_rooms" --role="builder" --next-role="user" << 'CHATROOM_HANDOFF_END'
      ---MESSAGE---
      [Your message here]
      CHATROOM_HANDOFF_END
      \`\`\`

      </handoffs>

      ============================================================
      A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer what to do from the message, not only from numbered next-steps. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="000000000000010002chatroom_rooms" --role="builder"\` for current chatroom task.
      ============================================================
      "
    `);

    // ===== VERIFY INIT PROMPT =====
    expect(initPrompt).toBeDefined();
    expect(initPrompt?.prompt).toBeDefined();

    // Should have role header
    expect(initPrompt?.prompt).toContain('# Duo Team');
    expect(initPrompt?.prompt).toContain('## Your Role: BUILDER');

    // Should have Getting Started section (not Available Actions)
    expect(initPrompt?.prompt).toContain('## Getting Started');
    expect(initPrompt?.prompt).toContain('### Context Recovery (after compaction/summarization)');
    expect(initPrompt?.prompt).toContain('### Get Next Task');

    // Should have task intake section
    expect(initPrompt?.prompt).toContain('### Start working');
    expect(initPrompt?.prompt).toContain('harness output (stdout tokens)');

    // Should have builder operating model instructions
    expect(initPrompt?.prompt).toContain('## Builder Operating Model');

    // Should include commands section
    expect(initPrompt?.prompt).toContain('### Commands');
    expect(initPrompt?.prompt).toContain('**Complete chatroom task and hand off:**');

    // ===== VERIFY TASK DELIVERY PROMPT =====
    expect(taskDeliveryPrompt).toBeDefined();
    expect(taskDeliveryPrompt.fullCliOutput).toBeDefined();
    expect(taskDeliveryPrompt.json).toBeDefined();

    // ===== VERIFY context view-template hint presence (init prompt only) =====
    expect(fullCliMessage).toContain('chatroom context view-template');

    // ===== VERIFY FULL CLI OUTPUT FORMAT =====
    const fullOutput = taskDeliveryPrompt.fullCliOutput;

    expect(fullOutput).toContain('<handoff-templates>');
    expect(fullOutput).toContain('<handoffs>');
    expect(fullOutput).toContain('you MUST run the handoff command');

    // Should have unified next-steps with handoff command
    expect(fullOutput).toContain('handoff command');
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
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItemIds?.length).toBeGreaterThan(
      0
    );
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItems).toBeDefined();
    expect(jsonContext.contextWindow.originMessage?.attachedBacklogItems?.length).toBeGreaterThan(
      0
    );

    // Verify backlog item details
    const attachedItem = jsonContext.contextWindow.originMessage?.attachedBacklogItems?.[0];
    expect(attachedItem).toBeDefined();
    expect(attachedItem?.content).toContain('Fix: Agent lacks knowledge');
    expect(attachedItem?.status).toBe('backlog');

    // Should have role prompt context
    expect(jsonContext.rolePrompt).toBeDefined();
    expect(jsonContext.rolePrompt.availableHandoffRoles).toContain('planner');

    // Should have chatroom metadata
    expect(jsonContext.chatroomId).toBe(chatroomId);
    expect(jsonContext.role).toBe('builder');
    expect(jsonContext.teamName).toBe('Duo Team');
    expect(jsonContext.teamRoles).toContain('builder');
    expect(jsonContext.teamRoles).toContain('planner');
  });

  test('formats task info section correctly for CLI display', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-task-info-format');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

  test('includes classification info when message is tagged', async () => {
    // Setup
    const { sessionId } = await createTestSession('test-classification-info');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

    // Role prompt has no classification until message is tagged (legacy data model)
    expect(taskDeliveryPrompt.json.rolePrompt.currentClassification).toBeNull();

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', startResult.taskId));
    expect(task?.sourceMessageId).toBeDefined();
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_messages', task!.sourceMessageId!, {
        classification: 'new_feature',
        featureTitle: 'User Authentication',
        featureDescription: 'Add login/logout functionality',
        featureTechSpecs: 'Use JWT tokens, bcrypt for passwords',
      });
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
    const role = 'planner';
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

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=planner
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

describe('Get-Next-Task Recent Improvements', () => {
  test('guidance text contains updated content (no longer references timeouts)', () => {
    const guidance = getNextTaskGuidance();
    const reminder = getNextTaskReminder();

    // Updated guidance should contain key sections
    expect(guidance).toContain('STAYING CONNECTED TO YOUR TEAM');
    expect(guidance).toContain('get-next-task');
    expect(guidance).toContain('Stay available to receive chatroom tasks from your team');
    expect(guidance).toContain('source of truth');
    expect(guidance).toContain('typical role patterns');

    // Should NOT contain shell-specific language that is misleading for coding agents
    expect(guidance).not.toContain('FOREGROUND');
    expect(guidance).not.toContain('nohup');
    expect(guidance).not.toContain('backgrounding');
    expect(guidance).not.toContain('active terminal');
    expect(guidance).not.toContain('blocking execution');
    expect(guidance).not.toContain('HOW WAIT-FOR-TASK WORKS');
    expect(guidance).not.toContain('The command may timeout before a task arrives');

    // Reminder should be a single-line reminder with resolution semantics
    expect(reminder).toContain('blocks until the user or team message is ready');
    expect(reminder).toContain('Message availability requires');
    expect(reminder).toContain('blocking tool call');
    expect(reminder).toContain('grace-period');
    expect(reminder).toContain('get-next-task');
  });

  test('attached backlog tasks appear in task delivery prompt JSON', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-attached-backlog-in-prompt');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const result = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.type).toBe('no_tasks');
  });

  test('getPendingTasksForRole returns superseded when connectionId does not match', async () => {
    const { sessionId } = await createTestSession('test-superseded-response');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    // Join with a specific connectionId
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      connectionId: 'conn-current',
    });
    await joinParticipants(sessionId, chatroomId, ['planner']);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    expect(attachedItem?.content).toBe(
      'Refactor: extract shared auth helpers into a utility module'
    );
    expect(attachedItem?.status).toBe('backlog');

    // ── Verify CLI output includes backlog attachment in primary delivery ──
    const fullOutput = taskDeliveryPrompt.fullCliOutput;
    expect(fullOutput).toContain('<attachments>');
    expect(fullOutput).toContain('type="backlog"');
    expect(fullOutput).toContain(`backlog-item-id="${backlogItemId}"`);
    const taskContentIdx = fullOutput.indexOf('Can you work on this backlog item?');
    const attachmentsIdx = fullOutput.indexOf('<attachments>');
    expect(attachmentsIdx).toBeLessThan(taskContentIdx);
  });

  test('readTask mutation returns attached backlog items from source message', async () => {
    // Verifies that the readTask mutation (used by CLI `task read` command)
    // correctly returns attachedBacklogItems when the source message has them.
    const { sessionId } = await createTestSession('test-readtask-backlog-items');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // Create a chatroom_backlog item
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Add dead code elimination pillar',
      createdBy: 'user',
    });

    // User sends message with backlog item attached
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please work on this backlog item',
      type: 'message',
      attachedBacklogItemIds: [backlogItemId],
    });

    // Builder claims the task
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    // Get the task ID from the acknowledged task
    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();

    // Use readTask mutation (the one used by CLI `task read`)
    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    // Verify backlog items are returned
    expect(result.attachedBacklogItems).toBeDefined();
    expect(result.attachedBacklogItems).toHaveLength(1);
    expect(result.attachedBacklogItems![0].content).toBe('Add dead code elimination pillar');
    expect(result.attachedBacklogItems![0].status).toBe('backlog');
    expect(result.attachedBacklogItems![0]._id).toBe(backlogItemId);
  });

  test('readTask mutation returns attached snippets from source message', async () => {
    const { sessionId } = await createTestSession('test-readtask-snippets');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'What library is [attachment: attachment-reference-001]?',
      type: 'message',
      attachedSnippets: [
        {
          reference: 'attachment-reference-001',
          fileSource: './windsurfrules',
          selectedContent: '# Shadcn',
        },
      ],
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();

    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    expect(result.attachedSnippets).toBeDefined();
    expect(result.attachedSnippets).toHaveLength(1);
    expect(result.attachedSnippets![0].reference).toBe('attachment-reference-001');
    expect(result.attachedSnippets![0].fileSource).toBe('./windsurfrules');
    expect(result.attachedSnippets![0].selectedContent).toBe('# Shadcn');
  });

  test('readTask mutation returns attached tasks from source message', async () => {
    const { sessionId } = await createTestSession('test-readtask-attached-tasks');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const attachedTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        content: 'Fix login redirect',
        createdBy: 'user',
        status: 'backlog',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please work on this attached task',
      type: 'message',
      attachedTaskIds: [attachedTaskId],
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();

    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    expect(result.attachedTasks).toBeDefined();
    expect(result.attachedTasks).toHaveLength(1);
    expect(result.attachedTasks![0].content).toBe('Fix login redirect');
    expect(result.attachedTasks![0].status).toBe('backlog');
    expect(result.attachedTasks![0]._id).toBe(attachedTaskId);
  });

  test('readTask mutation returns attached messages from source message', async () => {
    const { sessionId } = await createTestSession('test-readtask-attached-messages');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const priorMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Prior discussion about login',
        type: 'message',
      });
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Please review the prior discussion',
      type: 'message',
      attachedMessageIds: [priorMessageId],
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();

    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    expect(result.attachedMessages).toBeDefined();
    expect(result.attachedMessages).toHaveLength(1);
    expect(result.attachedMessages![0].content).toBe('Prior discussion about login');
    expect(result.attachedMessages![0].senderRole).toBe('user');
    expect(result.attachedMessages![0]._id).toBe(priorMessageId);
  });

  test('getTaskDeliveryPrompt.fullCliOutput includes attached snippets from source message', async () => {
    const { sessionId } = await createTestSession('test-delivery-snippets');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const userMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'What library is [attachment: attachment-reference-001]?',
      type: 'message',
      attachedSnippets: [
        {
          reference: 'attachment-reference-001',
          fileSource: './windsurfrules',
          selectedContent: '# Shadcn',
        },
      ],
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    const startResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const taskDeliveryPrompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: startResult.taskId,
      messageId: userMessageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    const fullOutput = taskDeliveryPrompt.fullCliOutput;
    expect(fullOutput).toContain('<attachments>');
    expect(fullOutput).toContain('<snippet file-source="./windsurfrules">');
    expect(fullOutput).toContain('<user-selected-content>');
    expect(fullOutput).toContain('# Shadcn');
    expect(fullOutput).toContain('[attachment: attachment-reference-001]');

    expect(taskDeliveryPrompt.json.message?.attachedSnippets).toHaveLength(1);
  });

  test('readTask mutation returns no attachedBacklogItems when source message has none', async () => {
    const { sessionId } = await createTestSession('test-readtask-no-backlog-items');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // User sends message WITHOUT backlog items
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Just a regular message',
      type: 'message',
    });

    // Builder claims the task
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    // Get the task ID
    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();

    // Use readTask mutation
    const result = await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    // Should not have attachedBacklogItems
    expect(result.attachedBacklogItems).toBeUndefined();
  });
});
