/**
 * Task-Complete Command Prompt Tests
 *
 * Tests for task-complete command generator to ensure it produces
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { taskCompleteCommand } from '../../../prompts/base/cli/task-complete/command';
import { getConfig } from '../../../prompts/config/index';

// Test URLs for different environments
const TEST_LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const TEST_PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

describe('Task-Complete Command', () => {
  test('generates task-complete command with placeholders when minimal params provided', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const command = taskCompleteCommand({ cliEnvPrefix });

    // Should use placeholder values
    expect(command).toContain('<chatroom-id>');
    expect(command).toContain('--role=<role>');

    // Should be the task-complete command
    expect(command).toContain('chatroom task-complete');
  });

  test('generates task-complete command with injected values', () => {
    // Use local URL which returns the env prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_LOCAL_CONVEX_URL);
    const command = taskCompleteCommand({
      chatroomId: 'complete-test-789',
      role: 'builder',
      cliEnvPrefix,
    });

    // Should inject CHATROOM_CONVEX_URL prefix
    expect(command).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should inject chatroom ID
    expect(command).toContain('--chatroom-id=complete-test-789');

    // Should inject role
    expect(command).toContain('--role=builder');
  });

  test('is a simple one-liner command (no heredoc or file input)', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const command = taskCompleteCommand({
      chatroomId: 'simple-test',
      role: 'reviewer',
      cliEnvPrefix,
    });

    // Should NOT contain HERE document or file input
    expect(command).not.toContain('EOF');
    expect(command).not.toContain('<<');
    expect(command).not.toContain('--file=');

    // Should be a single line
    expect(command.split('\n').length).toBe(1);
  });
});
