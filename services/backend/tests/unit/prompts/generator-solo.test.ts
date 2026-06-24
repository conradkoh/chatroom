/**
 * Generator tests — solo team detection and dispatch
 */

import { describe, expect, test } from 'vitest';

import { composeSystemPrompt } from '../../../prompts/generator';

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

    expect(prompt).toContain('Available targets: user');
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
    expect(prompt).not.toContain('hand off to builder');
    expect(prompt).not.toContain('delegate to planner');
  });

  test('solo team prompt includes getting started and task intake', () => {
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
    expect(prompt).toContain('### Start working');
    expect(prompt).toContain('### Commands');
    expect(prompt).not.toContain('chatroom classify');
  });
});
