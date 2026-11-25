/**
 * Prompt Generation Tests
 *
 * Tests for prompt generation functions to ensure they produce
 * concise, properly formatted output with correct variable injection.
 */

import { describe, expect, test } from 'vitest';

import { getContextGainingGuidance } from '../../../prompts/base/shared/getting-started-content';
import { generateAgentPrompt } from '../../../prompts/base/webapp/init/generator';
import { handoffCommand } from '../../../prompts/cli/handoff/command';
import {
  getTaskStartedPrompt,
  getTaskStartedPromptForHandoffRecipient,
} from '../../../prompts/cli/task-started/main-prompt';

describe('Context Gaining Prompt', () => {
  test('generates Getting Started format with basic commands', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'test-chatroom-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'unset',
    });

    // Should use Getting Started header (not Available Actions)
    expect(guidance).toContain('## Getting Started');

    // Should have Context Recovery section (replaces old "Read Context" startup step)
    expect(guidance).toContain('### Context Recovery (after compaction/summarization)');

    // Should have Get Next Task section
    expect(guidance).toContain('### Get Next Task');

    // Should inject CHATROOM_CONVEX_URL properly
    expect(guidance).toContain('CHATROOM_CONVEX_URL=http://127.0.0.1:3210');

    // Should include the log-anchoring recovery commands with correct parameters
    expect(guidance).toContain(
      'chatroom messages anchor --chatroom-id="test-chatroom-123" --role="builder"'
    );
    expect(guidance).not.toContain('chatroom context read');

    // Should be concise (no verbose explanations)
    expect(guidance).not.toContain('Best Practices');
    expect(guidance).not.toContain('When to Gain Context');
  });

  test('includes get-next-task command', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'abc123',
      role: 'planner',
      convexUrl: 'http://localhost:3000',
      agentType: 'unset',
    });

    expect(guidance).toContain('chatroom get-next-task --chatroom-id="abc123" --role="planner"');
  });

  test('defaults to <remote|custom> placeholder when agentType is not specified', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'test-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'unset',
    });

    expect(guidance).toContain('--type=<remote|custom>');
  });

  test('uses --type=custom when agentType is custom', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'test-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(guidance).toContain('--type=custom');
    expect(guidance).not.toContain('--type=<remote|custom>');
  });

  test('uses --type=remote when agentType is remote', () => {
    const guidance = getContextGainingGuidance({
      chatroomId: 'test-123',
      role: 'builder',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'remote',
    });

    expect(guidance).toContain('--type=remote');
    expect(guidance).not.toContain('--type=<remote|custom>');
  });
});

describe('Webapp Agent Prompt', () => {
  test('generates register-agent command with --type=custom', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'test-chatroom-456',
      role: 'planner',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      convexUrl: 'http://127.0.0.1:3210',
    });

    // Webapp prompts should always use --type=custom
    expect(prompt).toContain('--type=custom');
    expect(prompt).not.toContain('--type=<remote|custom>');
  });

  test('webapp prompt includes correct register-agent command format', () => {
    const prompt = generateAgentPrompt({
      chatroomId: 'my-chatroom-id',
      role: 'builder',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).toContain(
      'chatroom register-agent --chatroom-id="my-chatroom-id" --role="builder" --type=custom'
    );
  });
});

describe('Task intake prompt', () => {
  test('generates start-working format with token activity note', () => {
    const prompt = getTaskStartedPrompt();

    expect(prompt).toContain('### Start working');
    expect(prompt).toContain('harness output (stdout tokens)');
    expect(prompt).not.toContain('chatroom classify');
    expect(prompt).not.toContain('chatroom context new');
    expect(prompt).not.toMatch(/task read --chatroom-id/i);
  });

  test('handoff recipient prompt describes inline task body', () => {
    const prompt = getTaskStartedPromptForHandoffRecipient();

    expect(prompt).toContain('task body contains your work description');
    expect(prompt).toContain('harness output (stdout tokens)');
  });
});

describe('Command Generators - Stdin Consistency', () => {
  describe('handoff command', () => {
    test('uses namespaced heredoc delimiter', () => {
      const command = handoffCommand({
        chatroomId: 'test-123',
        role: 'builder',
        nextRole: 'planner',
        cliEnvPrefix: '',
      });

      expect(command).toContain("<< 'CHATROOM_HANDOFF_END'");
      expect(command).toContain('[Your message here]');
      expect(command).toContain('CHATROOM_HANDOFF_END');
      expect(command).not.toContain("<< 'EOF'");
      expect(command).not.toContain('--message');
    });
  });
});
