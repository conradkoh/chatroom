/**
 * Pair Team — Builder Classify Reminder
 *
 * Verifies the classify reminder prompt generated for the builder role
 * in a Pair team. Tests `generateTaskStartedReminder` which produces
 * role-specific guidance after acknowledging a task via `classify`.
 *
 * In pair team, builder is the entry point and can hand off to user or reviewer.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'builder',
  chatroomId: 'test-chatroom-id',
  messageId: 'test-message-id',
  taskId: 'test-task-id',
  convexUrl: 'http://127.0.0.1:3210',
  teamRoles: ['builder', 'reviewer'] as string[],
  teamName: 'Pair',
};

describe('Pair Team > Builder > Classify Reminder', () => {
  test('question classification', () => {
    const reminder = generateTaskStartedReminder(
      BASE_PARAMS.role,
      'question',
      BASE_PARAMS.chatroomId,
      BASE_PARAMS.messageId,
      BASE_PARAMS.taskId,
      BASE_PARAMS.convexUrl,
      BASE_PARAMS.teamRoles,
      BASE_PARAMS.teamName
    );

    expect(reminder).toBeDefined();
    expect(reminder).toContain('QUESTION');
    // Pair builder can hand off to user for questions
    expect(reminder).toContain('hand off directly to user');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Send a progress update: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id="test-chatroom-id" --role="builder" << 'EOF'
      ---MESSAGE---
      [Your progress message here]
      EOF\`
      2. Answer the user's question
      3. When done, hand off directly to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role="user" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Task ID: test-task-id"
    `);
  });

  test('new_feature classification', () => {
    const reminder = generateTaskStartedReminder(
      BASE_PARAMS.role,
      'new_feature',
      BASE_PARAMS.chatroomId,
      BASE_PARAMS.messageId,
      BASE_PARAMS.taskId,
      BASE_PARAMS.convexUrl,
      BASE_PARAMS.teamRoles,
      BASE_PARAMS.teamName
    );

    expect(reminder).toBeDefined();
    expect(reminder).toContain('NEW FEATURE');
    // Pair builder must hand off to reviewer for new features
    expect(reminder).toContain('reviewer');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Implement the feature
      2. Send \`report-progress\` at milestones (e.g., after major changes, when blocked)
      3. Commit your changes
      4. MUST hand off to reviewer for approval:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role="reviewer" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      💡 You're working on:
      Task ID: test-task-id"
    `);
  });

  test('follow_up classification', () => {
    const reminder = generateTaskStartedReminder(
      BASE_PARAMS.role,
      'follow_up',
      BASE_PARAMS.chatroomId,
      BASE_PARAMS.messageId,
      BASE_PARAMS.taskId,
      BASE_PARAMS.convexUrl,
      BASE_PARAMS.teamRoles,
      BASE_PARAMS.teamName
    );

    expect(reminder).toBeDefined();
    expect(reminder).toContain('FOLLOW UP');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as FOLLOW UP.

      **Next steps:**
      1. Complete the follow-up work
      2. Send \`report-progress\` at milestones for visibility
      3. Follow-up inherits the workflow rules from the original task:
         - If original was a QUESTION → hand off to user when done
         - If original was a NEW FEATURE → hand off to reviewer when done

      💡 You're working on:
      Task ID: test-task-id"
    `);
  });
});
