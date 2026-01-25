/**
 * Task-Complete Command Prompt Tests
 *
 * Tests for task-complete command generator to ensure it produces
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { taskCompleteCommand } from '../../prompts/base/cli/task-complete/command';

describe('Task-Complete Command', () => {
  test('generates task-complete command with placeholders when no params provided', () => {
    const command = taskCompleteCommand();

    // Should use placeholder values
    expect(command).toContain('<chatroom-id>');
    expect(command).toContain('--role=<role>');

    // Should be the task-complete command
    expect(command).toContain('chatroom task-complete');
  });

  test('generates task-complete command with injected values', () => {
    const command = taskCompleteCommand({
      chatroomId: 'complete-test-789',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    // Should inject CHATROOM_CONVEX_URL prefix
    expect(command).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should inject chatroom ID
    expect(command).toContain('chatroom task-complete complete-test-789');

    // Should inject role
    expect(command).toContain('--role=builder');
  });

  test('is a simple one-liner command (no heredoc or file input)', () => {
    const command = taskCompleteCommand({
      chatroomId: 'simple-test',
      role: 'reviewer',
    });

    // Should NOT contain HERE document or file input
    expect(command).not.toContain('EOF');
    expect(command).not.toContain('<<');
    expect(command).not.toContain('--file=');

    // Should be a single line
    expect(command.split('\n').length).toBe(1);
  });
});
