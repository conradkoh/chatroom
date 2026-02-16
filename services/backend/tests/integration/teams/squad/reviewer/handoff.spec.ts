/**
 * Squad Team — Reviewer Handoff (Task Started Reminder)
 *
 * Verifies the task-started reminder prompt generated for the reviewer role
 * in a Squad team. This is the `generateTaskStartedReminder` function which
 * produces role-specific guidance after acknowledging a task.
 *
 * In squad team, reviewer hands off to planner (not user).
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'reviewer',
  chatroomId: 'test-chatroom-id',
  messageId: 'test-message-id',
  taskId: 'test-task-id',
  convexUrl: 'http://127.0.0.1:3210',
  teamRoles: ['planner', 'builder', 'reviewer'] as string[],
  teamName: 'Squad',
};

describe('Squad Team > Reviewer > Handoff (Task Started Reminder)', () => {
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
    // Squad reviewer should hand off to planner
    expect(reminder).toContain('planner');

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
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
    expect(reminder).toContain('planner');

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
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
    expect(reminder).toContain('planner');

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the work meets requirements, hand off to planner for user delivery. If changes are needed, hand off to builder with specific feedback.

      💡 You're reviewing:
      Task ID: test-task-id"
    `);
  });
});
