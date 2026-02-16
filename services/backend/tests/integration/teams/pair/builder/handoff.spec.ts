/**
 * Pair Team — Builder Handoff (Task Started Reminder)
 *
 * Verifies the task-started reminder generated for a builder in a Pair team
 * across all three classification types: question, new_feature, follow_up.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 * Pure function test — no Convex test client needed.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

describe('Pair Team > Builder > Handoff (Task Started Reminder)', () => {
  const baseParams = {
    role: 'builder',
    chatroomId: 'test-chatroom-id',
    messageId: 'test-message-id',
    taskId: 'test-task-id',
    convexUrl: 'http://127.0.0.1:3210',
    teamRoles: ['builder', 'reviewer'],
    teamName: 'Pair',
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
      1. Send a progress update: \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress --chatroom-id=test-chatroom-id --role=builder << 'EOF'
      [Your progress message here]
      EOF\`
      2. Answer the user's question
      3. When done, hand off directly to user:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=user << 'EOF'
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
      1. Implement the feature
      2. Send \`report-progress\` at milestones (e.g., after major changes, when blocked)
      3. Commit your changes
      4. MUST hand off to reviewer for approval:

      \`\`\`bash
      CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom handoff --chatroom-id=test-chatroom-id --role=builder --next-role=reviewer << 'EOF'
      [Your message here]
      EOF
      \`\`\`

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
      1. Complete the follow-up work
      2. Send \`report-progress\` at milestones for visibility
      3. Follow-up inherits the workflow rules from the original task:
         - If original was a QUESTION → hand off to user when done
         - If original was a NEW FEATURE → hand off to reviewer when done

      💡 You're working on:
      Message ID: test-message-id"
    `);
  });
});
