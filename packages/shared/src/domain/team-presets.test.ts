import { describe, expect, test } from 'vitest';

import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESETS,
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
});
