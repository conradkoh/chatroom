/**
 * Pair Team — Reviewer Wait-For-Task Output
 *
 * Verifies the full CLI output delivered when the reviewer receives a task
 * via wait-for-task in a Pair team. Tests the `generateFullCliOutput` function
 * which is the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/base/cli/wait-for-task/fullOutput';

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
  availableHandoffTargets: ['builder', 'user'],
};

describe('Pair Team > Reviewer > Wait For Task', () => {
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
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
    // Non-entry point should NOT have context creation step
    expect(output).not.toContain('set a new context');
    expect(output).toContain('Available targets: builder, user');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Message ID: test-message-id
      From: user

      ## User Message
      <user-message>
      Please review the dark mode changes
      </user-message>

      ## Task
      Review the dark mode implementation
      </task>

      <process>
      ============================================================
      📋 PROCESS
      ============================================================

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=follow_up

      2. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=reviewer << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      3. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=reviewer
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=reviewer --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=reviewer
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=reviewer --status=backlog

      4. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target>
         Available targets: builder, user

      5. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=reviewer
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Acknowledge and classify this message:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=<type>

      Classification types: question, new_feature, follow_up

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      Step 2. Do the work following the PROCESS section above.

      Step 3. Hand off when complete.
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
    expect(output).toContain('📋 TASK');
    expect(output).toContain('handed off from builder');
    expect(output).not.toContain('Acknowledge and classify');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Message ID: test-message-id
      From: builder

      ## User Message
      <user-message>
      Please implement dark mode for the settings page
      </user-message>

      ## Task
      Review the dark mode implementation

      Classification: NEW_FEATURE
      </task>

      <process>
      ============================================================
      📋 PROCESS
      ============================================================

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --no-classify

      2. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=reviewer << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      3. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=reviewer
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=reviewer --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=reviewer
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=reviewer --status=backlog

      4. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target>
         Available targets: builder, user

      5. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=reviewer
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Task handed off from builder — start work immediately.

      Step 2. Do the work following the PROCESS section above.

      Step 3. Hand off when complete.
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
      ============================================================"
    `);
  });
});
