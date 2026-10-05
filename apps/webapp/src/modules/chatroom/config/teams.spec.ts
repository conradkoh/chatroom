import { TEAM_PRESET_IDS } from '@workspace/shared/domain/team-kind';
import {
  DEFAULT_TEAM_PRESET_ID,
  getPermanentRolesForPreset,
  TEAM_PRESETS,
} from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import { TEAMS_CONFIG } from './teams';

describe('TEAMS_CONFIG canonical picker projection', () => {
  test('includes each shared preset in canonical order with its name and entry point', () => {
    expect(Object.keys(TEAMS_CONFIG.teams)).toEqual(TEAM_PRESET_IDS);
    expect(TEAMS_CONFIG.defaultTeam).toBe(DEFAULT_TEAM_PRESET_ID);
    for (const teamId of TEAM_PRESET_IDS) {
      expect(TEAMS_CONFIG.teams[teamId]).toMatchObject({
        name: TEAM_PRESETS[teamId].name,
        entryPoint: TEAM_PRESETS[teamId].entryPoint,
      });
    }
  });

  test('shows only permanent roles in the picker and retains pinned builtin assignments', () => {
    expect(TEAMS_CONFIG.teams.duo.roles).toEqual(['planner', 'builder']);
    expect(TEAMS_CONFIG.teams.solo.roles).toEqual(['solo']);
    for (const teamId of TEAM_PRESET_IDS) {
      expect(TEAMS_CONFIG.teams[teamId].roles).toEqual(getPermanentRolesForPreset(teamId));
    }
  });

  test('retains presentation descriptions independently of full structure descriptions', () => {
    expect(TEAMS_CONFIG.teams.duo.description).toBe(
      'A planner and builder working as a pair, planner as coordinator'
    );
    expect(TEAMS_CONFIG.teams.solo.description).toBe('A single agent working independently');
  });
});
