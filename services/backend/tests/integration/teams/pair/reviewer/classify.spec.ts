/**
 * Pair Team — Reviewer Classify Reminder
 *
 * Verifies the classify reminder prompt generated for the reviewer role
 * in a Pair team. Tests `generateTaskStartedReminder` which produces
 * role-specific guidance after acknowledging a task via `classify`.
 *
 * In pair team, reviewer can hand off to user or builder.
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
  teamRoles: ['builder', 'reviewer'] as string[],
  teamName: 'Pair',
};

describe('Pair Team > Reviewer > Classify Reminder', () => {
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
    // Pair reviewer should hand off to user or builder
    expect(reminder).toContain('user');

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the user's goal is met, hand off to user. If not, provide specific feedback and hand off to builder.

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
    expect(reminder).toContain('user');

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the user's goal is met, hand off to user. If not, provide specific feedback and hand off to builder.

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

    expect(reminder).toMatchInlineSnapshot(`
      "Review the completed work. If the user's goal is met, hand off to user. If not, provide specific feedback and hand off to builder.

      💡 You're reviewing:
      Task ID: test-task-id"
    `);
  });
});
