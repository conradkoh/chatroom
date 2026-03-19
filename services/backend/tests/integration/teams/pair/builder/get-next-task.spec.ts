/**
 * Pair Team — Builder Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the builder receives a task
 * via get-next-task in a Pair team. Tests the `generateFullCliOutput` function
 * which is the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/cli/get-next-task/fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature as described',
  },
  currentContext: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: true,
  availableHandoffTargets: ['reviewer', 'user'],
};

describe('Pair Team > Builder > Get Next Task', () => {
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
    expect(output).toContain('📋 TASK');
    expect(output).toContain('<next-steps>');
    // Entry point should have context creation step
    expect(output).toContain('Code changes expected?');
    // User message should trigger classification flow
    expect(output).toContain('Classify');
    expect(output).toContain('targets: reviewer, user');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: user

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\`

      ## Task
      To read this task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id"
      \`\`\`
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.

      1. Read task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id"\`
      2. Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --origin-message-classification=<type>\`

         new_feature example:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      3. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="test-chatroom-id" --role="builder" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF\`
      4. Hand off when complete:

      ⚠️ Before delivering to user: Verify the codebase is in a good state.
         Run: pnpm typecheck && pnpm test
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: reviewer, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="builder"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\` for current task.
      ============================================================"
    `);
  });

  test('task from team member (reviewer)', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'reviewer',
        content: 'Changes approved. Please fix the minor issue noted.',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('handed off from reviewer');
    expect(output).not.toContain('Classify →');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: reviewer

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\`

      ## Task
      To read this task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id"
      \`\`\`

      Classification: NEW_FEATURE
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the task to mark it as in_progress.
         handed off from reviewer — start work immediately.

      1. Read task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id"\`
      2. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id="test-chatroom-id" --role="builder" --trigger-message-id="<userMessageId>" << 'EOF'
      <summary of current focus>
      EOF\`
      3. Hand off when complete:

      ⚠️ Before delivering to user: Verify the codebase is in a good state.
         Run: pnpm typecheck && pnpm test
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: reviewer, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you. If this command was moved to background, terminate and restart it.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="builder"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\` for current task.
      ============================================================"
    `);
  });
});
