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
  test('canonical duo and solo shapes include optional ephemeral support roles', () => {
    expect(TEAM_PRESETS.duo).toMatchObject({
      name: 'Duo',
      roles: ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
      entryPoint: 'planner',
    });
    expect(TEAM_PRESETS.solo).toMatchObject({
      name: 'Solo',
      roles: ['solo', 'architect', 'triage', 'uiux-engineer'],
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

  test.each([
    [
      'duo',
      'duo@1',
      'Duo',
      'planner',
      ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
    ],
    [
      'duo@1',
      'duo@1',
      'Duo',
      'planner',
      ['planner', 'architect', 'triage', 'uiux-engineer', 'builder'],
    ],
    ['solo', 'solo@1', 'Solo', 'solo', ['solo', 'architect', 'triage', 'uiux-engineer']],
    ['solo@1', 'solo@1', 'Solo', 'solo', ['solo', 'architect', 'triage', 'uiux-engineer']],
  ] as const)(
    'resolves %s from persisted roles that omit triage',
    (teamId, teamStructureId, teamName, entryPoint, roles) => {
      const structure = getTeamStructure({
        teamId,
        persistedRoles: teamName === 'Duo' ? ['planner', 'builder'] : ['solo'],
      });
      expect(structure).toMatchObject({
        teamId: teamStructureId.split('@')[0],
        teamStructureId,
        teamName,
        entryPoint,
        roles: roles.map((role) => ({
          role,
          lifecycle: ['architect', 'triage', 'uiux-engineer'].includes(role)
            ? 'ephemeral'
            : 'permanent',
          optional: ['architect', 'triage', 'uiux-engineer'].includes(role),
        })),
      });
      expect(structure.roles.find(({ role }) => role === 'triage')).toEqual({
        role: 'triage',
        lifecycle: 'ephemeral',
        optional: true,
      });
      expect(
        getTeamStructure({ teamId: 'duo' }).roles.some(({ role }) => role === 'enhancer')
      ).toBe(false);
    }
  );
});
