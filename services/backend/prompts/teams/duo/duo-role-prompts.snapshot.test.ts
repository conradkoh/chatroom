/**
 * Characterisation snapshots for the duo team's role prompts.
 *
 * Pins, for every role duo renders, the per-message role prompt and the init
 * system prompt in CLI and native variants. Captured before the per-team
 * isolation refactor; must stay byte-identical after it.
 */

import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import {
  renderInitSystemPrompt,
  renderRolePrompt,
  rolesUnderCharacterisation,
  type CharacterisationTeam,
} from '../role-prompt-characterisation';

const TEAM: CharacterisationTeam = {
  teamId: 'duo',
  teamName: TEAM_PRESETS.duo.name,
  teamRoles: [...TEAM_PRESETS.duo.roles],
};

describe('duo role prompts (characterisation)', () => {
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
