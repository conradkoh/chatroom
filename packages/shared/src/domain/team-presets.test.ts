import { describe, expect, test } from 'vitest';

import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESETS,
  getTeamStructure,
  getPermanentRolesForPreset,
  getTeamPreset,
  getTeamStructureId,
  listTeamPresetIds,
} from './team-presets';

describe('team presets', () => {
  test('canonical duo and solo shapes include optional design advisors', () => {
    expect(TEAM_PRESETS.duo).toMatchObject({
      name: 'Duo',
      roles: ['planner', 'architect', 'uiux-engineer', 'builder'],
      entryPoint: 'planner',
    });
    expect(TEAM_PRESETS.solo).toMatchObject({
      name: 'Solo',
      roles: ['solo', 'architect', 'uiux-engineer'],
      entryPoint: 'solo',
    });
    expect(DEFAULT_TEAM_PRESET_ID).toBe('duo');
  });

  test('lists and resolves known preset IDs', () => {
    expect(listTeamPresetIds()).toEqual(['duo', 'solo']);
    expect(getTeamPreset('duo')).toBe(TEAM_PRESETS.duo);
    expect(getTeamPreset('duo@1')).toBe(TEAM_PRESETS.duo);
    expect(getTeamStructureId('duo')).toBe('duo@1');
    expect(getTeamPreset('unknown')).toBeUndefined();
  });

  test('permanent roles include only the permanent entry-point roles', () => {
    expect(getPermanentRolesForPreset('duo')).toEqual(['planner', 'builder']);
    expect(getPermanentRolesForPreset('solo')).toEqual(['solo']);
  });

  test('resolves canonical structure with optional ephemeral design advisors', () => {
    expect(
      getTeamStructure({
        teamId: 'duo',
        teamName: 'Duo',
        persistedRoles: ['planner', 'builder'],
      })
    ).toEqual({
      teamId: 'duo',
      teamStructureId: 'duo@1',
      teamName: 'Duo',
      entryPoint: 'planner',
      roles: [
        { role: 'planner', lifecycle: 'permanent', optional: false },
        { role: 'architect', lifecycle: 'ephemeral', optional: true },
        { role: 'uiux-engineer', lifecycle: 'ephemeral', optional: true },
        { role: 'builder', lifecycle: 'permanent', optional: false },
      ],
    });
    expect(getTeamStructure({ teamId: 'duo' }).roles.some(({ role }) => role === 'enhancer')).toBe(
      false
    );
  });
});
