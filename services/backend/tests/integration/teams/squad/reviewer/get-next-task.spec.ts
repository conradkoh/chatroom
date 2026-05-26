/**
 * Squad Team — Reviewer Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the reviewer receives a task
 * via get-next-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/cli/get-next-task/fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'reviewer',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Review the dark mode implementation',
  },
  currentContext: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: false,
  availableHandoffTargets: ['builder', 'planner'],
};

describe('Squad Team > Reviewer > Get Next Task', () => {
  test('task from user', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please review the dark mode changes',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please review the dark mode changes',
        classification: null,
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 CHATROOM TASK');
    expect(output).toContain('<next-steps>');
    // Non-entry point should NOT have context creation step
    expect(output).not.toContain('Set a new context per user message');
    expect(output).toContain('targets: builder, planner');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: user

      ## Context
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="reviewer"\`

      ## Chatroom task
      To read this chatroom task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id"
      \`\`\`
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.

      1. Read chatroom task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id"\`
      2. Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id" --origin-message-classification=<type>\`

         new_feature example:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom classify --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF
      3. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="reviewer" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, planner)
      </next-steps>

      ============================================================
      Message availability is critical: Run only one \`get-next-task\` in the foreground at a time. Before reconnecting, terminate any older backgrounded \`get-next-task\` processes (stale waiters can acknowledge tasks and trigger a grace-period cooldown for your active session). If this command was moved to background, kill it and restart a single foreground instance.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="reviewer"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="reviewer"\` for current chatroom task.
      ============================================================"
    `);
  });

  test('task from team member (builder)', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'builder',
        content: 'Dark mode implementation complete. Please review.',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 CHATROOM TASK');
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
      (read if needed) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="reviewer"\`

      ## Chatroom task
      To read this chatroom task and mark it as in_progress, run:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id"
      \`\`\`

      Classification: NEW_FEATURE
      </task>

      <next-steps>
      ⚠️  REQUIRED FIRST STEP: Read the chatroom task to mark it as in_progress.
         handed off from builder — start work immediately.

      1. Read chatroom task → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task read --chatroom-id="test-chatroom-id" --role="reviewer" --task-id="test-task-id"\`
      2. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="reviewer" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, planner)
      </next-steps>

      ============================================================
      Message availability is critical: Run only one \`get-next-task\` in the foreground at a time. Before reconnecting, terminate any older backgrounded \`get-next-task\` processes (stale waiters can acknowledge tasks and trigger a grace-period cooldown for your active session). If this command was moved to background, kill it and restart a single foreground instance.
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="reviewer"\` to reload prompt, and \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="reviewer"\` for current chatroom task.
      ============================================================"
    `);
  });
});
