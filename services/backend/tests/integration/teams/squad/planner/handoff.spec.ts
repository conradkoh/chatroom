/**
 * Squad Team — Planner Handoff (Task Started Reminder)
 *
 * Verifies the task-started reminder generated for a planner in a Squad team
 * across all three classification types: question, new_feature, follow_up.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 * Pure function test — no Convex test client needed.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

describe('Squad Team > Planner > Handoff (Task Started Reminder)', () => {
  const baseParams = {
    role: 'planner',
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
    expect(reminder).toContain('QUESTION');
    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as QUESTION.

      **Next steps:**
      1. Answer the user's question
      2. When done, hand off to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=user << 'EOF'
      [Your message here]
      EOF
      \`\`\`

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
    expect(reminder).toContain('NEW FEATURE');
    expect(reminder).toMatchInlineSnapshot(`
      "✅ Task acknowledged as NEW FEATURE.

      **Next steps:**
      1. Decompose the task into clear, actionable work items
      2. Delegate implementation to builder:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=planner --next-role=builder << 'EOF'
      [Your message here]
      EOF
      \`\`\`

      3. Review completed work before delivering to user
      4. Hand back for rework if requirements are not met

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
      Message ID: test-message-id"
    `);
  });
});
