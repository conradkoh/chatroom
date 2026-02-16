/**
 * Squad Team — Builder Handoff (Task Started Reminder)
 *
 * Verifies the task-started reminder generated for a builder in a Squad team
 * across all three classification types: question, new_feature, follow_up.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 * Pure function test — no Convex test client needed.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

describe('Squad Team > Builder > Handoff (Task Started Reminder)', () => {
  const baseParams = {
    role: 'builder',
    chatroomId: 'test-chatroom-id',
    messageId: 'test-message-id',
    taskId: 'test-task-id',
    convexUrl: 'http://127.0.0.1:3210',
    teamRoles: ['planner', 'builder', 'reviewer'],
    teamName: 'Squad',
  };

  test('question classification', () => {
    const reminder = generateTaskStartedReminder(
      baseParams.role,
      'question',
      baseParams.chatroomId,
      baseParams.messageId,
      baseParams.taskId,
      baseParams.convexUrl,
      baseParams.teamRoles,
      baseParams.teamName
    );
    expect(reminder).toBeDefined();
    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to reviewer when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In squad team, never hand off directly to user — go through the planner.

      💡 You're working on:
      Message ID: test-message-id"
    `);
  });

  test('new_feature classification', () => {
    const reminder = generateTaskStartedReminder(
      baseParams.role,
      'new_feature',
      baseParams.chatroomId,
      baseParams.messageId,
      baseParams.taskId,
      baseParams.convexUrl,
      baseParams.teamRoles,
      baseParams.teamName
    );
    expect(reminder).toBeDefined();
    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to reviewer when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In squad team, never hand off directly to user — go through the planner.

      💡 You're working on:
      Message ID: test-message-id"
    `);
  });

  test('follow_up classification', () => {
    const reminder = generateTaskStartedReminder(
      baseParams.role,
      'follow_up',
      baseParams.chatroomId,
      baseParams.messageId,
      baseParams.taskId,
      baseParams.convexUrl,
      baseParams.teamRoles,
      baseParams.teamName
    );
    expect(reminder).toBeDefined();
    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as FOLLOW UP.

      **Next steps:**
      1. Implement the requested changes
      2. Send \`report-progress\` at milestones
      3. Hand off to reviewer when complete:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      ⚠️ In squad team, never hand off directly to user — go through the planner.

      💡 You're working on:
      Message ID: test-message-id"
    `);
  });
});
