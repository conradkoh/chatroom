/**
 * Acceptance test for the verifier's rendered prompts.
 *
 * The verifier judges the user's request and verdict contract from log message
 * ids, so none of its rendered prompts may carry a context-read reference — for
 * any team preset. Every other role keeps the context machinery, so the same
 * team must still render the reference for a non-verifier role.
 *
 * Uses the public render helpers from `role-prompt-characterisation.ts`, which
 * go through `generateRolePrompt` and `composeInitPrompt`.
 */

import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import {
  renderInitSystemPrompt,
  renderRolePrompt,
  rolesUnderCharacterisation,
  type CharacterisationTeam,
} from './role-prompt-characterisation';

const TEAMS: CharacterisationTeam[] = [
  { teamId: 'duo', teamName: TEAM_PRESETS.duo.name, teamRoles: [...TEAM_PRESETS.duo.roles] },
  { teamId: 'solo', teamName: TEAM_PRESETS.solo.name, teamRoles: [...TEAM_PRESETS.solo.roles] },
  { teamId: 'trio', teamName: TEAM_PRESETS.trio.name, teamRoles: [...TEAM_PRESETS.trio.roles] },
  {
    teamId: 'characterisation-custom-team',
    teamName: 'Custom Team',
    teamRoles: ['tester', 'architect', 'builder', 'specifier'],
  },
];

const CONTEXT_REFERENCE = /chatroom context|context read/i;

describe.each(TEAMS)('verifier prompts for $teamId', (team) => {
  test('role prompt has no context-read reference', () => {
    expect(renderRolePrompt(team, 'verifier')).not.toMatch(CONTEXT_REFERENCE);
  });
  test('cli init prompt has no context-read reference', () => {
    expect(renderInitSystemPrompt(team, 'verifier')).not.toMatch(CONTEXT_REFERENCE);
  });
  test('native init prompt has no context-read reference', () => {
    expect(renderInitSystemPrompt(team, 'verifier', 'claude-sdk')).not.toMatch(CONTEXT_REFERENCE);
  });
  test('still tells a compacted verifier to reload its prompt and download the log', () => {
    const prompt = renderInitSystemPrompt(team, 'verifier');
    expect(prompt).toContain('get-system-prompt');
    expect(prompt).toContain('messages download');
  });
  test('a non-verifier role in the same team still carries the context-read reference', () => {
    const others = rolesUnderCharacterisation(team).filter((role) => role !== 'verifier');
    expect(others.some((role) => CONTEXT_REFERENCE.test(renderRolePrompt(team, role)))).toBe(true);
  });
});
