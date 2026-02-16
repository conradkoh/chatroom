/**
 * Squad Team — Planner Wait-For-Task Output
 *
 * Verifies the full CLI output delivered when the planner receives a task
 * via wait-for-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/base/cli/wait-for-task/fullOutput';

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

describe('Squad Team > Planner > Wait For Task', () => {
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
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
    // Entry point should have context creation step
    expect(output).toContain('set a new context');
    // User message should trigger classification flow
    expect(output).toContain('Acknowledge and classify');
    expect(output).toContain('Available targets: builder, reviewer, user');

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
      Please implement dark mode for the settings page
      </user-message>

      ## Task
      Implement the feature as described
      </task>

      <process>
      ============================================================
      📋 PROCESS
      ============================================================

      1. If code changes / commits are expected, set a new context:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      <summary of current focus>
      EOF

      2. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=planner --task-id=test-task-id --origin-message-classification=follow_up

      3. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      4. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=planner
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=planner --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=planner
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=planner --status=backlog

      5. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=<target>
         Available targets: builder, reviewer, user

      6. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=planner
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Acknowledge and classify this message:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=planner --task-id=test-task-id --origin-message-classification=<type>

      Classification types: question, new_feature, follow_up

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=planner --task-id=test-task-id --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      Step 2. If code changes are expected, create a new context before starting work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      <summary of current focus>
      EOF

      Step 3. Do the work following the PROCESS section above.

      Step 4. Hand off when complete.
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
    // Team handoff should show "handed off from" instead of classification
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
      Implement the feature as described

      Classification: NEW_FEATURE
      </task>

      <process>
      ============================================================
      📋 PROCESS
      ============================================================

      1. If code changes / commits are expected, set a new context:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      <summary of current focus>
      EOF

      2. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=planner --task-id=test-task-id --no-classify

      3. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      4. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=planner
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=planner --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=planner
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=planner --status=backlog

      5. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=<target>
         Available targets: builder, reviewer, user

      6. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=planner
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Task handed off from builder — start work immediately.

      Step 2. If code changes are expected, create a new context before starting work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=planner << 'EOF'
      <summary of current focus>
      EOF

      Step 3. Do the work following the PROCESS section above.

      Step 4. Hand off when complete.
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
      ============================================================"
    `);
  });
});
