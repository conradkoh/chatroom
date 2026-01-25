/**
 * Prompt Generation Tests
 *
 * Tests for prompt generation functions to ensure they produce
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { handoffCommand } from '../../prompts/base/cli/handoff/command';
import { getContextGainingGuidance } from '../../prompts/base/cli/init/context-gaining';
import { taskCompleteCommand } from '../../prompts/base/cli/task-complete/command';
import { getTaskStartedPrompt } from '../../prompts/base/cli/task-started/main-prompt';
import { getAvailableActions } from '../../prompts/base/cli/wait-for-task/available-actions';

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
    expect(guidance).toContain('chatroom context read test-chatroom-123 --role=builder');

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

    expect(guidance).toContain('chatroom wait-for-task abc123 --role=reviewer');
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
    const prompt = getTaskStartedPrompt({
      chatroomId: 'test-chatroom-456',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    // Should have Classify Task header
    expect(prompt).toContain('### Classify Task');

    // Should have all three classification types
    expect(prompt).toContain('#### Question');
    expect(prompt).toContain('#### Follow Up');
    expect(prompt).toContain('#### New Feature');
  });

  test('injects CHATROOM_CONVEX_URL prefix correctly', () => {
    const prompt = getTaskStartedPrompt({
      chatroomId: 'my-chatroom',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    // All commands should have the env prefix
    expect(prompt).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom task-started');
  });

  test('new_feature command uses EOF format for metadata', () => {
    const prompt = getTaskStartedPrompt({
      chatroomId: 'feature-chatroom',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://localhost:3210 ',
    });

    // New feature should use heredoc format
    expect(prompt).toContain("--origin-message-classification=new_feature << 'EOF'");
    expect(prompt).toContain('---TITLE---');
    expect(prompt).toContain('---DESCRIPTION---');
    expect(prompt).toContain('---TECH_SPECS---');
    expect(prompt).toContain('EOF');
  });

  test('question and follow_up commands are simple one-liners', () => {
    const prompt = getTaskStartedPrompt({
      chatroomId: 'simple-chatroom',
      role: 'reviewer',
      cliEnvPrefix: '',
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
    const prompt = getTaskStartedPrompt({
      chatroomId: 'concise-test',
      role: 'builder',
      cliEnvPrefix: '',
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
