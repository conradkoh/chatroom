/**
 * Squad Team — Builder Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the builder receives a task
 * via get-next-task. Tests the `generateFullCliOutput` function which is
 * the backend-generated template printed by the CLI.
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
  isEntryPoint: false,
  availableHandoffTargets: ['reviewer', 'planner'],
};

describe('Squad Team > Builder > Get Next Task', () => {
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
    // Non-entry point should NOT have context creation step
    expect(output).not.toContain('Code changes expected?');
    expect(output).toContain('targets: reviewer, planner');

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
      1. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --origin-message-classification=follow_up\`
      2. (optional) Read context if needed → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\` _(skip if you already have full context)_
      3. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id="test-chatroom-id" --role="builder" << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      4. Do the work
      5. Hand off (targets: reviewer, planner) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF\`
      6. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="builder"\`

      Reference commands:
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id="test-chatroom-id" --role="builder" --sender-role=user --limit=5 --full\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id="test-chatroom-id" --role="builder" --status=backlog\`
        git log → \`git log --oneline -10\`
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      \`\`\`mermaid
      flowchart TD
          A([Start]) --> B[Read user message]
          B --> C{message type?}
          C -->|question or follow_up| D[Classify with --origin-message-classification=type]
          C -->|new_feature| E["Classify with --origin-message-classification=new_feature
      requires --title, --description, --tech-specs"]
          D --> F([Stop])
          E --> F
      \`\`\`

      Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --origin-message-classification=<type>\`

      new_feature example:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --origin-message-classification=new_feature << 'EOF'
      ---TITLE---
      <title>
      ---DESCRIPTION---
      <description>
      ---TECH_SPECS---
      <tech-specs>
      EOF
      2. Do the work → follow PROCESS above
      3. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: reviewer, planner)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="builder"\` to reload your role prompt.
      ============================================================"
    `);
  });

  test('task from team member (planner)', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      message: {
        _id: 'test-message-id',
        senderRole: 'planner',
        content: 'Please implement the dark mode toggle component.',
      },
      originMessage: {
        senderRole: 'user',
        content: 'Please implement dark mode for the settings page',
        classification: 'new_feature',
      },
    });

    expect(output).toBeDefined();
    expect(output).toContain('📋 TASK');
    expect(output).toContain('handed off from planner');
    expect(output).not.toContain('Classify →');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
      From: planner

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
      1. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id="test-chatroom-id" --role="builder" --task-id="test-task-id" --no-classify\`
      2. (optional) Read context if needed → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="test-chatroom-id" --role="builder"\` _(skip if you already have full context)_
      3. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id="test-chatroom-id" --role="builder" << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      4. Do the work
      5. Hand off (targets: reviewer, planner) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF\`
      6. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="builder"\`

      Reference commands:
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id="test-chatroom-id" --role="builder" --sender-role=user --limit=5 --full\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id="test-chatroom-id" --role="builder" --status=backlog\`
        git log → \`git log --oneline -10\`
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      handed off from planner — start work immediately.
      1. Do the work → follow PROCESS above
      2. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: reviewer, planner)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you
      Context compacted? Run \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-system-prompt --chatroom-id="test-chatroom-id" --role="builder"\` to reload your role prompt.
      ============================================================"
    `);
  });
});
