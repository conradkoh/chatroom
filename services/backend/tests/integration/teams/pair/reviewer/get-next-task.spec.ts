/**
 * Pair Team — Reviewer Get-Next-Task Output
 *
 * Verifies the full CLI output delivered when the reviewer receives a task
 * via get-next-task in a Pair team. Tests the `generateFullCliOutput` function
 * which is the backend-generated template printed by the CLI.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../../../prompts/base/cli/get-next-task/fullOutput';

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

describe('Pair Team > Reviewer > Get Next Task', () => {
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
    expect(output).not.toContain('Code changes expected?');
    expect(output).toContain('targets: builder, user');

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
      Please review the dark mode changes
      </user-message>

      ## Task
      Review the dark mode implementation
      </task>

      <process>
      ============================================================
      📋 PROCESS
      ============================================================
      1. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=follow_up\`
      2. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=reviewer << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      3. Do the work
      4. Hand off (targets: builder, user) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF\`
      5. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=test-chatroom-id --role=reviewer\`

      Reference commands:
        context read → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=reviewer\`
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=reviewer --sender-role=user --limit=5 --full\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=reviewer --status=backlog\`
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

      Classify → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=<type>\`

      new_feature example:
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --origin-message-classification=new_feature << 'EOF'
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
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you
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
    expect(output).not.toContain('Classify →');

    expect(output).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 TASK
      ============================================================
      Task ID: test-task-id
      Origin Message ID: test-message-id
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
      1. Acknowledge → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started --chatroom-id=test-chatroom-id --role=reviewer --task-id=test-task-id --no-classify\`
      2. Report progress at milestones → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=reviewer << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      3. Do the work
      4. Hand off (targets: builder, user) → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF\`
      5. Resume → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=test-chatroom-id --role=reviewer\`

      Reference commands:
        context read → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id=test-chatroom-id --role=reviewer\`
        messages → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom messages list --chatroom-id=test-chatroom-id --role=reviewer --sender-role=user --limit=5 --full\`
        backlog → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom backlog list --chatroom-id=test-chatroom-id --role=reviewer --status=backlog\`
        git log → \`git log --oneline -10\`
      </process>

      <next-steps>
      ============================================================
      📋 NEXT STEPS
      ============================================================

      handed off from builder — start work immediately.
      1. Do the work → follow PROCESS above
      2. Hand off when complete:
      \`\`\`
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=reviewer --next-role=<target> << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`
      (targets: builder, user)
      </next-steps>

      ============================================================
      Message availability is critical: Use \`get-next-task\` in the foreground to stay connected, otherwise your team cannot reach you
      ============================================================"
    `);
  });
});
