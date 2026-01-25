/**
 * Handoff Command Prompt Tests
 *
 * Tests for handoff command generator to ensure it produces
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { handoffCommand } from '../../prompts/base/cli/handoff/command';

describe('Handoff Command', () => {
  test('generates handoff command with placeholders when no params provided', () => {
    const command = handoffCommand();

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
    const command = handoffCommand({
      chatroomId: 'my-chatroom-456',
      role: 'builder',
      nextRole: 'reviewer',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
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
    const command = handoffCommand({
      chatroomId: 'test-123',
      role: 'reviewer',
      nextRole: 'user',
    });

    // Should use HERE document, not file path
    expect(command).toContain("<< 'EOF'");
    expect(command).not.toContain('--file=');
    expect(command).not.toContain('.md');
  });
});
