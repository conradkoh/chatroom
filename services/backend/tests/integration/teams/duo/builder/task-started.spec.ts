/**
 * Duo Team — Builder Task Started Reminder
 *
 * Verifies the task-started reminder prompt generated for the builder role
 * in a Duo team. Tests `generateTaskStartedReminder` which produces
 * role-specific guidance after acknowledging a task via `task-started`.
 *
 * In duo team, builder hands off to planner, never to user.
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
  teamRoles: ['planner', 'builder'] as string[],
  teamName: 'Duo',
};

describe('Duo Team > Builder > Task Started Reminder', () => {
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
    // Duo builder should never hand off to user
    expect(reminder).toContain('never hand off directly to user');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to planner when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role="planner" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In duo team, never hand off directly to user — go through the planner.

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
    expect(reminder).toContain('never hand off directly to user');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to planner when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role="planner" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In duo team, never hand off directly to user — go through the planner.

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
    expect(reminder).toContain('never hand off directly to user');

    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as FOLLOW UP.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to planner when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id="test-chatroom-id" --role="builder" --next-role="planner" << 'EOF'
      ---MESSAGE---
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In duo team, never hand off directly to user — go through the planner.

      💡 You're working on:
      Task ID: test-task-id"
    `);
  });
});
