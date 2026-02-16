/**
 * Squad Team — Builder Wait For Task
 *
 * Verifies the full CLI output generated when a builder in a Squad team
 * receives a task via wait-for-task. Tests both user-originated and
 * team-member-originated task scenarios.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 * Pure function test — no Convex test client needed.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/base/cli/wait-for-task/fullOutput';

describe('Squad Team > Builder > Wait For Task', () => {
  test('task from user', () => {
    const output = generateFullCliOutput({
      chatroomId: 'test-chatroom-id',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'test-task-id', content: 'Implement the feature as described' },
      message: {
        _id: 'test-message-id',
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
      },
      currentContext: null,
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: null,
      },
      followUpCountSinceOrigin: 0,
      originMessageCreatedAt: null,
      isEntryPoint: false,
      availableHandoffTargets: ['reviewer', 'planner'],
    });
    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('📋 PROCESS');
    expect(output).toContain('📋 NEXT STEPS');
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

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=follow_up

      2. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      3. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=builder
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=builder --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=builder
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=builder --status=backlog

      4. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=<target>
         Available targets: reviewer, planner

      5. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=builder
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Acknowledge and classify this message:

      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=<type>

      Classification types: question, new_feature, follow_up

      📝 Classification Requirements:
         • question: No additional fields required
         • follow_up: No additional fields required
         • new_feature: REQUIRES --title, --description, --tech-specs

      💡 Example for new_feature:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=new_feature << 'EOF'
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

  test('task from team member', () => {
    const output = generateFullCliOutput({
      chatroomId: 'test-chatroom-id',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'test-task-id', content: 'Implement the feature as described' },
      message: {
        _id: 'test-message-id',
        senderRole: 'planner',
        content: 'Please implement the dark mode feature for settings',
      },
      currentContext: null,
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: null,
      },
      followUpCountSinceOrigin: 0,
      originMessageCreatedAt: null,
      isEntryPoint: false,
      availableHandoffTargets: ['reviewer', 'planner'],
    });
    expect(output).toBeDefined();
    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Message ID: test-message-id
      From: planner

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

      1. Mark task as started:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --no-classify

      2. Report progress frequently — small, incremental updates as you work:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      [Your progress message here]
      EOF

         Keep updates short and frequent (e.g. after each milestone or subtask).

      3. Do the work

         Available commands:
         • Read context: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=builder
         • List messages: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=builder --sender-role=user --limit=5 --full
         • View code changes: git log --oneline -10
         • Complete task (no handoff): CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=builder
         • View backlog: CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=builder --status=backlog

      4. Hand off when complete:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=<target>
         Available targets: reviewer, planner

      5. Resume listening:
         CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=builder
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      Step 1. Task handed off from planner — start work immediately.

      Step 2. Do the work following the PROCESS section above.

      Step 3. Hand off when complete.
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
      ============================================================"
    `);
  });
});
