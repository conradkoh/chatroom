/**
 * Pair Team — Builder Wait-For-Task Output
 *
 * Verifies the full CLI output delivered when the builder receives a task
 * via wait-for-task in a Pair team. Tests the `generateFullCliOutput` function
 * which is the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/base/cli/wait-for-task/fullOutput';

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

describe('Pair Team > Builder > Wait For Task', () => {
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
      1. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      <summary of current focus>
      EOF\`
      2. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=follow_up\`
      3. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      4. Do the work
      5. Hand off → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=<target>\` (targets: reviewer, user)
      6. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=builder\`

      Reference commands:
        context read → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=builder\`
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=builder --sender-role=user --limit=5 --full\`
        task-complete → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=builder\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=builder --status=backlog\`
        git log → \`git log --oneline -10\`
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      \`\`\`
      @startuml
      start
      :Read user message;
      if (message type?) then (question or follow_up)
        :Classify with --origin-message-classification=<type>;
      else (new_feature)
        :Classify with --origin-message-classification=new_feature;
        note right: requires --title, --description, --tech-specs
      endif
      stop
      @enduml
      \`\`\`

      Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=<type>\`

      new_feature example:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF

      2. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      <summary of current focus>
      EOF\`
      3. Do the work → follow PROCESS above
      4. Hand off when complete
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
      1. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      <summary of current focus>
      EOF\`
      2. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=builder --task-id=test-task-id --no-classify\`
      3. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      4. Do the work
      5. Hand off → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=<target>\` (targets: reviewer, user)
      6. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=test-chatroom-id --role=builder\`

      Reference commands:
        context read → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=builder\`
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=builder --sender-role=user --limit=5 --full\`
        task-complete → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-complete --chatroom-id=test-chatroom-id --role=builder\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=builder --status=backlog\`
        git log → \`git log --oneline -10\`
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      handed off from reviewer — start work immediately.
      1. Code changes expected? → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context new --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      <summary of current focus>
      EOF\`
      2. Do the work → follow PROCESS above
      3. Hand off when complete
      </next-steps>

      ============================================================
      Message availability is critical: Use \`wait-for-task\` in the foreground to stay connected, otherwise your team cannot reach you
      ============================================================"
    `);
  });
});
