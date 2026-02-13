/**
 * Prompt Generation Tests
 *
 * Tests for prompt generation functions to ensure they produce
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { handoffCommand } from '../../../prompts/base/cli/handoff/command';
import { reportProgressCommand } from '../../../prompts/base/cli/report-progress/command';
import { getTaskStartedPrompt } from '../../../prompts/base/cli/task-started/main-prompt';
import { getAvailableActions } from '../../../prompts/base/cli/wait-for-task/available-actions';
import { getContextGainingGuidance } from '../../../prompts/base/shared/getting-started-content';
import { getConfig } from '../../../prompts/config/index';

// Test URLs for different environments
const TEST_LOCAL_CONVEX_URL = 'http://127.0.0.1:3210';
const TEST_LOCALHOST_CONVEX_URL = 'http://localhost:3210';
const TEST_PRODUCTION_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

describe('Context Gaining Prompt', () => {
  test('generates Getting Started format with basic commands', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Should use Getting Started header (not Available Actions)
    expect(guidance).toContain('## Getting Started');

    // Should have Read Context section
    expect(guidance).toContain('### Read Context');

    // Should have Wait for Tasks section
    expect(guidance).toContain('### Wait for Tasks');

    // Should inject CHATROOM_CONVEX_URL properly
    expect(guidance).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should include the context read command with correct parameters
    expect(guidance).toContain(
      'chatroom context read --chatroom-id=test-chatroom-123 --role=builder'
    );

    // Should be concise (no verbose explanations)
    expect(guidance).not.toContain('Best Practices');
    expect(guidance).not.toContain('When to Gain Context');
  });

  test('includes wait-for-task command', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'abc123',
      role: 'reviewer',
      convexUrl: 'http://localhost:3000',
    });

    expect(guidance).toContain('chatroom wait-for-task --chatroom-id=abc123 --role=reviewer');
  });
});

describe('Available Actions (Task Delivery)', () => {
  test('generates Available Actions format with all actions', () => {
    const actions = getAvailableActions({
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Should use Available Actions header
    expect(actions).toContain('## Available Actions');

    // Should have all action sections
    expect(actions).toContain('### Gain Context');
    expect(actions).toContain('### List Messages');
    expect(actions).toContain('### View Code Changes');
    expect(actions).toContain('### Complete Task');
    expect(actions).toContain('### Backlog');

    // Should inject CHATROOM_CONVEX_URL properly
    expect(actions).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');
  });

  test('includes git log command', () => {
    const actions = getAvailableActions({
      chatroomId: 'abc123',
      role: 'reviewer',
      convexUrl: 'http://localhost:3000',
    });

    expect(actions).toContain('git log --oneline -10');
  });
});

describe('Task Classification Prompt', () => {
  test('generates concise Classify Task format with all classification types', () => {
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_LOCAL_CONVEX_URL);
    const prompt = getTaskStartedPrompt({
      chatroomId: 'test-chatroom-456',
      role: 'builder',
      cliEnvPrefix,
    });

    // Should have Classify Task header
    expect(prompt).toContain('### Classify Task');

    // Should have all three classification types
    expect(prompt).toContain('#### Question');
    expect(prompt).toContain('#### Follow Up');
    expect(prompt).toContain('#### New Feature');
  });

  test('injects CHATROOM_CONVEX_URL prefix correctly', () => {
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_LOCAL_CONVEX_URL);
    const prompt = getTaskStartedPrompt({
      chatroomId: 'my-chatroom',
      role: 'builder',
      cliEnvPrefix,
    });

    // All commands should have the env prefix
    expect(prompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started');
  });

  test('new_feature command uses EOF format for metadata', () => {
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_LOCALHOST_CONVEX_URL);
    const prompt = getTaskStartedPrompt({
      chatroomId: 'feature-chatroom',
      role: 'builder',
      cliEnvPrefix,
    });

    // New feature should use heredoc format
    expect(prompt).toContain("--origin-message-classification=new_feature << 'EOF'");
    expect(prompt).toContain('---TITLE---');
    expect(prompt).toContain('---DESCRIPTION---');
    expect(prompt).toContain('---TECH_SPECS---');
    expect(prompt).toContain('EOF');
  });

  test('question and follow_up commands are simple one-liners', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const prompt = getTaskStartedPrompt({
      chatroomId: 'simple-chatroom',
      role: 'reviewer',
      cliEnvPrefix,
    });

    // Question command should be a simple command without heredoc
    const questionMatch = prompt.match(/--origin-message-classification=question[^\n]*/);
    expect(questionMatch).toBeTruthy();
    expect(questionMatch?.[0]).not.toContain('EOF');

    // Follow up command should be a simple command without heredoc
    const followUpMatch = prompt.match(/--origin-message-classification=follow_up[^\n]*/);
    expect(followUpMatch).toBeTruthy();
    expect(followUpMatch?.[0]).not.toContain('EOF');
  });

  test('is concise without verbose classification guidance', () => {
    // Use production URL which returns empty prefix
    const cliEnvPrefix = getConfig().getCliEnvPrefix(TEST_PRODUCTION_CONVEX_URL);
    const prompt = getTaskStartedPrompt({
      chatroomId: 'concise-test',
      role: 'builder',
      cliEnvPrefix,
    });

    // Should NOT contain verbose guidance sections
    expect(prompt).not.toContain('Classification Types');
    expect(prompt).not.toContain('When to use:');
    expect(prompt).not.toContain('Characteristics:');
    expect(prompt).not.toContain('Examples:');
    expect(prompt).not.toContain('Workflow:');
    expect(prompt).not.toContain('Handoff Rules:');
  });
});

describe('Command Generators - Stdin Consistency', () => {
  describe('report-progress command', () => {
    test('uses EOF format (stdin) instead of --message flag', () => {
      const command = reportProgressCommand({
        chatroomId: 'test-123',
        role: 'builder',
        cliEnvPrefix: '',
      });

      // Should use EOF format
      expect(command).toContain("<< 'EOF'");
      expect(command).toContain('EOF');

      // Should NOT use --message flag
      expect(command).not.toContain('--message');
    });

    test('includes placeholder for message content', () => {
      const command = reportProgressCommand({
        chatroomId: 'abc',
        role: 'reviewer',
        cliEnvPrefix: '',
      });

      // Should have placeholder text for message
      expect(command).toMatch(/\[.*\]/); // Contains placeholder in brackets
    });

    test('injects environment prefix correctly', () => {
      const command = reportProgressCommand({
        chatroomId: 'test-123',
        role: 'builder',
        cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      });

      expect(command).toContain(
        'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom report-progress'
      );
    });

    test('matches handoff command format consistency', () => {
      const reportCmd = reportProgressCommand({
        chatroomId: 'test',
        role: 'builder',
        cliEnvPrefix: '',
      });

      const handoffCmd = handoffCommand({
        chatroomId: 'test',
        role: 'builder',
        nextRole: 'reviewer',
        cliEnvPrefix: '',
      });

      // Both should use EOF format
      expect(reportCmd).toContain("<< 'EOF'");
      expect(handoffCmd).toContain("<< 'EOF'");

      // Both should have similar structure
      const reportLines = reportCmd.split('\n');
      const handoffLines = handoffCmd.split('\n');

      // Should be multiline with EOF wrapper
      expect(reportLines.length).toBeGreaterThan(1);
      expect(handoffLines.length).toBeGreaterThan(1);
    });
  });

  describe('handoff command', () => {
    test('already uses EOF format (baseline)', () => {
      const command = handoffCommand({
        chatroomId: 'test-123',
        role: 'builder',
        nextRole: 'reviewer',
        cliEnvPrefix: '',
      });

      // Verify handoff is already correct
      expect(command).toContain("<< 'EOF'");
      expect(command).toContain('[Your message here]');
      expect(command).toContain('EOF');
      expect(command).not.toContain('--message');
    });
  });
});
