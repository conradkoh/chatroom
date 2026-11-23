/**
 * Characterisation snapshots for an unknown/custom team's role prompts.
 *
 * No preset matches this team, so its prompts resolve through the frozen
 * legacy catalogue fallback. Pins, for every role it renders, the per-message
 * role prompt and the init system prompt in CLI and native variants. Captured
 * before the per-team isolation refactor; must stay byte-identical after it.
 */

import { describe, expect, test } from 'vitest';

import {
  renderInitSystemPrompt,
  renderRolePrompt,
  rolesUnderCharacterisation,
  type CharacterisationTeam,
} from '../role-prompt-characterisation';

const TEAM: CharacterisationTeam = {
  teamId: 'characterisation-custom-team',
  teamName: 'Custom Team',
  teamRoles: ['tester', 'architect', 'builder', 'specifier'],
};

describe('custom team role prompts (characterisation)', () => {
  test.each(rolesUnderCharacterisation(TEAM))('%s role prompt', (role) => {
    expect(renderRolePrompt(TEAM, role)).toMatchSnapshot();
  });

  test.each(rolesUnderCharacterisation(TEAM))('%s init prompt (cli)', (role) => {
    expect(renderInitSystemPrompt(TEAM, role)).toMatchSnapshot();
  });

  test.each(rolesUnderCharacterisation(TEAM))('%s init prompt (native)', (role) => {
    expect(renderInitSystemPrompt(TEAM, role, 'claude-sdk')).toMatchSnapshot();
  });
});
