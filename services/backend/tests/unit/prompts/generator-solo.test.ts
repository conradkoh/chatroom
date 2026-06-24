/**
 * Generator tests — solo team detection and dispatch
 *
 * Unit tests for detectTeamType, generateTaskStartedReminder,
 * and composeSystemPrompt with solo team configuration.
 */

import { describe, expect, test } from 'vitest';

import { generateTaskStartedReminder, composeSystemPrompt } from '../../../prompts/generator';

// Test solo detection through public APIs that exercise it indirectly:
// generateTaskStartedReminder and composeSystemPrompt both use
// buildSelectorContext → detectTeamType.

describe('generator > solo team detection', () => {
  test('generateTaskStartedReminder produces solo-specific new_feature reminder', () => {
    const reminder = generateTaskStartedReminder(
      'solo',
      'new_feature',
      'chatroom-123',
      undefined,
      'task-456',
      'http://127.0.0.1:3210',
      ['solo'],
      'solo-team'
    );

    expect(reminder).toContain('NEW FEATURE');
    expect(reminder).toContain('Plan');
    expect(reminder).toContain('Implement');
    expect(reminder).toContain('Verify');
    expect(reminder).toContain('typecheck');
    expect(reminder).toContain('Deliver');
  });

  test('generateTaskStartedReminder produces solo-specific question reminder', () => {
    const reminder = generateTaskStartedReminder(
      'solo',
      'question',
      'chatroom-123',
      undefined,
      'task-456',
      'http://127.0.0.1:3210',
      ['solo'],
      'solo-team'
    );

    expect(reminder).toContain('QUESTION');
    expect(reminder).toContain('Answer');
    expect(reminder).toContain('hand off');
  });

  test('generateTaskStartedReminder produces solo-specific follow_up reminder', () => {
    const reminder = generateTaskStartedReminder(
      'solo',
      'follow_up',
      'chatroom-123',
      undefined,
      'task-456',
      'http://127.0.0.1:3210',
      ['solo'],
      'solo-team'
    );

    expect(reminder).toContain('FOLLOW UP');
    expect(reminder).toContain('Review');
    expect(reminder).toContain('typecheck');
  });
});

describe('generator > composeSystemPrompt with solo team', () => {
  test('solo team allows handoff to user', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'solo',
      teamName: 'Solo Team',
      teamRoles: ['solo'],
      teamEntryPoint: 'solo',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    // Solo team — can handoff to user
    expect(prompt).toContain('Available targets: user');
    // No restriction notice
    expect(prompt).not.toContain('only the planner can hand off');
  });

  test('solo team prompt contains solo role identity', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'solo',
      teamName: 'Solo Team',
      teamRoles: ['solo'],
      teamEntryPoint: 'solo',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(prompt).toContain('# Solo Team');
    expect(prompt).toContain('## Your Role: SOLO');
    expect(prompt).toContain('autonomous agent');
    // No team-specific delegation to other roles
    expect(prompt).not.toContain('hand off to builder');
    expect(prompt).not.toContain('delegate to planner');
  });

  test('solo team prompt includes getting started and classification', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'solo',
      teamName: 'Solo Team',
      teamRoles: ['solo'],
      teamEntryPoint: 'solo',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(prompt).toContain('## Getting Started');
    expect(prompt).toContain('### Classify message');
    expect(prompt).toContain('### Commands');
  });
});
