/**
 * Duo Team — Planner Task Started Reminder
 *
 * Verifies the task-started reminder prompt generated for the planner role
 * in a Duo team. Tests `generateTaskStartedReminder` which produces
 * role-specific guidance after acknowledging a task via `task-started`.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'planner',
  chatroomId: 'test-chatroom-id',
  messageId: 'test-message-id',
  taskId: 'test-task-id',
  convexUrl: 'http://127.0.0.1:3210',
  teamRoles: ['planner', 'builder'] as string[],
  teamName: 'Duo',
};

describe('Duo Team > Planner > Task Started Reminder', () => {
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
    expect(reminder).toContain('hand off to user');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Answer the user's question
      2. When done, hand off to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=user << 'EOF'
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
    expect(reminder).toContain('Decompose');
    expect(reminder).toContain('builder');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Decompose the task into clear, actionable work items
      2. Delegate implementation to builder:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=builder << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      3. Review completed work before delivering to user
      4. Hand back for rework if requirements are not met

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
      1. Review the follow-up request against previous work
      2. Delegate to appropriate team member or handle yourself
      3. Follow-up inherits the workflow rules from the original task:
         - If original was a QUESTION → handle and hand off to user when done
         - If original was a NEW FEATURE → delegate, review, and deliver to user

      💡 You're working on:
      Task ID: test-task-id"
    `);
  });
});
