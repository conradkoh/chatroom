import { describe, expect, test } from 'vitest';

import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESETS,
  getTeamStructure,
  getPermanentRolesForPreset,
  getTeamPreset,
  listTeamPresetIds,
} from './team-presets';

describe('team presets', () => {
  test('canonical duo and solo shapes include enhancer', () => {
    expect(TEAM_PRESETS.duo).toMatchObject({
      name: 'Duo',
      roles: ['planner', 'enhancer', 'builder'],
      entryPoint: 'planner',
    });
    expect(TEAM_PRESETS.solo).toMatchObject({
      name: 'Solo',
      roles: ['solo', 'enhancer'],
      entryPoint: 'solo',
    });
    expect(DEFAULT_TEAM_PRESET_ID).toBe('duo');
  });

  test('lists and resolves known preset IDs', () => {
    expect(listTeamPresetIds()).toEqual(['duo', 'solo']);
    expect(getTeamPreset('duo')).toBe(TEAM_PRESETS.duo);
    expect(getTeamPreset('unknown')).toBeUndefined();
  });

  test('permanent roles exclude enhancer', () => {
    expect(getPermanentRolesForPreset('duo')).toEqual(['planner', 'builder']);
    expect(getPermanentRolesForPreset('solo')).toEqual(['solo']);
  });

  test('resolves canonical structure independently of persisted runtime roles', () => {
    expect(
      getTeamStructure({
        teamId: 'duo',
        teamName: 'Duo',
        persistedRoles: ['planner', 'builder'],
      })
    ).toEqual({
      teamId: 'duo',
      teamName: 'Duo',
      entryPoint: 'planner',
      roles: [
        { role: 'planner', lifecycle: 'permanent', optional: false },
        { role: 'enhancer', lifecycle: 'ephemeral', optional: true },
        { role: 'builder', lifecycle: 'permanent', optional: false },
      ],
    });
  });
});
