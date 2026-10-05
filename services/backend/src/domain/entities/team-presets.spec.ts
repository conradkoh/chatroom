import {
  TEAM_PRESETS as sharedTeamPresets,
  getTeamStructure as getSharedTeamStructure,
} from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESETS,
  getTeamPreset,
  getTeamStructure,
  listTeamPresetIds,
} from './team-presets';

describe('team presets', () => {
  test('matches the supported duo and solo team shapes', () => {
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
    expect(getTeamPreset('unknown')).toBeUndefined();
  });

  test('backend facade uses the shared preset definitions and structure resolver', () => {
    expect(TEAM_PRESETS).toBe(sharedTeamPresets);
    expect(getTeamPreset('duo')).toBe(sharedTeamPresets.duo);
    expect(getTeamPreset('solo')).toBe(sharedTeamPresets.solo);
    for (const teamId of ['duo', 'solo'] as const) {
      expect(getTeamStructure({ teamId })).toEqual(getSharedTeamStructure({ teamId }));
    }
  });
});
