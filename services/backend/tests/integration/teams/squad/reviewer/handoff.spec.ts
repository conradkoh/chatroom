/**
 * Squad Team — Reviewer Handoff (Task Started Reminder)
 *
 * Verifies the task-started reminder generated for a reviewer in a Squad team
 * across all three classification types: question, new_feature, follow_up.
 *
 * Note: Reviewer reminders are simpler — they focus on review instructions
 * rather than classification-specific workflows.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 * Pure function test — no Convex test client needed.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

describe('Squad Team > Reviewer > Handoff (Task Started Reminder)', () => {
  const baseParams = {
    role: 'reviewer',
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
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
      Task ID: test-task-id"
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
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
      Task ID: test-task-id"
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
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
      Task ID: test-task-id"
    `);
  });
});
