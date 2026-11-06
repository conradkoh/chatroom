/**
 * Init-prompt handoff targets for enforced teams.
 *
 * Trio is the only enforced team: its roles advertise exactly their handoff
 * contract targets. Advisory teams (duo, solo) keep the configured-membership
 * list, which their own suites assert.
 */

import { describe, expect, test } from 'vitest';

import { composeSystemPrompt } from '../../../prompts/generator';

const TRIO_MEMBERSHIP = ['coordinator', 'specifier', 'builder'];

describe('generator > composeSystemPrompt with the enforced trio team', () => {
  test('trio specifier advertises only coordinator and builder', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'specifier',
      teamId: 'trio',
      teamName: 'Trio Team',
      teamRoles: TRIO_MEMBERSHIP,
      teamEntryPoint: 'coordinator',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(prompt).toMatch(/^Available targets: coordinator, builder$/m);
  });

  test('trio builder advertises only the specifier', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'builder',
      teamId: 'trio',
      teamName: 'Trio Team',
      teamRoles: TRIO_MEMBERSHIP,
      teamEntryPoint: 'coordinator',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(prompt).toMatch(/^Available targets: specifier$/m);
  });

  test('trio coordinator advertises the contract order without a builder', () => {
    const prompt = composeSystemPrompt({
      chatroomId: 'chatroom-123',
      role: 'coordinator',
      teamId: 'trio',
      teamName: 'Trio Team',
      teamRoles: TRIO_MEMBERSHIP,
      teamEntryPoint: 'coordinator',
      convexUrl: 'http://127.0.0.1:3210',
      agentType: 'custom',
    });

    expect(prompt).toMatch(
      /^Available targets: user, specifier, architect, uiux-engineer, triage, researcher, reviewer, game-asset-designer, verifier$/m
    );
  });
});
