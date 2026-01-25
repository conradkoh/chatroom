/**
 * Handoff Command Prompt Tests
 *
 * Tests for handoff command generator to ensure it produces
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { handoffCommand } from '../../prompts/base/cli/handoff/command';
import { getConfig } from '../../prompts/config/index';

// Test URLs for different environments
const TEST_LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const TEST_PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

describe('Handoff Command', () => {
  test('generates handoff command with placeholders when minimal params provided', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const command = handoffCommand({ cliEnvPrefix });

    // Should use placeholder values
    expect(command).toContain('<chatroom-id>');
    expect(command).toContain('--role=<role>');
    expect(command).toContain('--next-role=<target>');

    // Should use HERE document format
    expect(command).toContain("<< 'EOF'");
    expect(command).toContain('[Your message here]');
    expect(command).toContain('EOF');
  });

  test('generates handoff command with injected values', () => {
    // Use local URL which returns the env prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_LOCAL_CONVEX_URL);
    const command = handoffCommand({
      chatroomId: 'my-chatroom-456',
      role: 'builder',
      nextRole: 'reviewer',
      cliEnvPrefix,
    });

    // Should inject CHATROOM_CONVEX_URL prefix
    expect(command).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should inject chatroom ID
    expect(command).toContain('chatroom handoff my-chatroom-456');

    // Should inject role
    expect(command).toContain('--role=builder');

    // Should inject next role
    expect(command).toContain('--next-role=reviewer');

    // Should still use HERE document format
    expect(command).toContain("<< 'EOF'");
  });

  test('uses stdin HERE document format (not file-based)', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const command = handoffCommand({
      chatroomId: 'test-123',
      role: 'reviewer',
      nextRole: 'user',
      cliEnvPrefix,
    });

    // Should use HERE document, not file path
    expect(command).toContain("<< 'EOF'");
    expect(command).not.toContain('--file=');
    expect(command).not.toContain('.md');
  });
});
