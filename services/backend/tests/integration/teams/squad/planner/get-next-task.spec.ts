/**
 * Squad Team — Planner Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the planner receives a task
 * via get-next-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/cli/get-next-task/fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'planner',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature as described',
  },
  currentContext: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: true,
  availableHandoffTargets: ['builder', 'reviewer', 'user'],
};

describe('Squad Team > Planner > Get Next Task', () => {
  test('task from user', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: null,
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 CHATROOM TASK');
    expect(output).toContain('<next-steps>');
    // Entry point should have context creation step
    expect(output).toContain('Set a new context per user message');
    // User message should trigger classification flow
    expect(output).toContain('Classify');
    expect(output).toContain('targets: builder, reviewer, user');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: user

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="planner"\`

      ## Chatroom task
      To read this chatroom task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id"
      \`\`\`
      </task>

      <next-steps>
      This blocking \`get-next-task\` resolved because the user or team message is ready as a chatroom task. Infer what to do from that message—it is the source of truth. Numbered steps below are typical role patterns, not a rigid script.

      ⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.

      1. Read chatroom task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id"\`
      2. Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id" --origin-message-classification=<type>\`

         new_feature example:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      3. Set a new context per user message (default) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="test-chatroom-id" --role="planner" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.
      REQUIRED: All context content MUST conform to the template. Run \`chatroom context view-template\` and follow it exactly.
      4. Delegate ONE slice to the builder (a structured workflow is optional, not required):

      **Delegation Brief (Planner → Builder)** — paste into the handoff message and fill in:

      \`\`\`markdown
      ## Goal
      <one sentence: the outcome this slice delivers>

      ## Scope & Files
      - \`path/to/file.ts\` — <what to create/change> (use full paths when known)

      ## Requirements (acceptance criteria)
      - <verifiable outcome the builder can self-check>
      - Verify: \`pnpm typecheck && pnpm test\`

      ## Skills to activate (optional)
      - <e.g. CHATROOM_CONVEX_URL=<endpoint> chatroom skill activate software-engineering --chatroom-id=<id> --role=builder>

      ## Out of scope
      - <what NOT to touch>
      \`\`\`

      Keep one slice ≈ one focused review surface. Delegate slices incrementally — one at a time, not all at once.
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="planner" --next-role=builder << 'EOF'
      ---MESSAGE---
      [Your delegation brief here]
      EOF
      \`\`\`
      (targets: builder, reviewer, user)

      5. When the work is done, deliver to the user using this report template:

      ⚠️ Before delivering to user: Verify the codebase is in a good state.
         Run: pnpm typecheck && pnpm test

      **Report Template (Planner → User)** — the user can ONLY see this handoff message, so make it a complete, standalone document in markdown:

      \`\`\`markdown
      ## Summary
      <what was accomplished, in plain terms — no references to prior messages>

      ## Proof — files changed
      - \`path/to/file.ts\` — <what changed and why>
      <list every file you (or the builder) modified; this is the evidence of work>

      ## System Design
      <include a mermaid diagram when the change has non-trivial structure; omit only for trivial changes>

      \`\`\`mermaid
      flowchart TD
          A[Component] --> B[Component]
      \`\`\`

      ## Verification
      - \`pnpm typecheck && pnpm test\` — <result>

      ## Notes / Next steps
      <anything the user should know, follow-ups, or open questions — optional>
      \`\`\`
      </next-steps>

      ============================================================
      A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer what to do from the message, not only from numbered next-steps. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="planner"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="planner"\` for current chatroom task.
      ============================================================"
    `);
  });

  test('task from team member', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'builder',
        content: 'Implementation complete. All tests pass.',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 CHATROOM TASK');
    expect(output).toContain('<next-steps>');
    // Team handoff should show "handed off from" instead of classification
    expect(output).toContain('handed off from builder');
    expect(output).not.toContain('Classify →');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: builder

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="planner"\`

      ## Chatroom task
      To read this chatroom task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id"
      \`\`\`

      Classification: NEW_FEATURE
      </task>

      <next-steps>
      This blocking \`get-next-task\` resolved because the user or team message is ready as a chatroom task. Infer what to do from that message—it is the source of truth. Numbered steps below are typical role patterns, not a rigid script.

      ⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.
         handed off from builder — start work immediately.

      1. Read chatroom task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="planner" --task-id="test-task-id"\`
      2. Set a new context per user message (default) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="test-chatroom-id" --role="planner" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF\` — skip ONLY when the message is clearly a follow-up of the current chatroom task.
      REQUIRED: All context content MUST conform to the template. Run \`chatroom context view-template\` and follow it exactly.
      3. Hand off when complete:

      ⚠️ Before delivering to user: Verify the codebase is in a good state.
         Run: pnpm typecheck && pnpm test
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="planner" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, reviewer, user)
      </next-steps>

      ============================================================
      A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer what to do from the message, not only from numbered next-steps. Message availability requires exactly one such blocking tool call; the harness delivers chatroom tasks only while it blocks. Duplicate or backgrounded listeners can acknowledge tasks early and trigger grace-period cooldowns where your active session receives nothing.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="planner"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="planner"\` for current chatroom task.
      ============================================================"
    `);
  });
});
