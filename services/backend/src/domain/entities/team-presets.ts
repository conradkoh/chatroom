export interface TeamPreset {
  name: string;
  description: string;
  roles: string[];
  entryPoint: string;
}

export const TEAM_PRESETS: Record<string, TeamPreset> = {
  duo: {
    name: 'Duo',
    description: 'A planner and builder working as a pair, planner as coordinator',
    roles: ['planner', 'builder'],
    entryPoint: 'planner',
  },
  solo: {
    name: 'Solo',
    description: 'A single agent working independently',
    roles: ['solo'],
    entryPoint: 'solo',
  },
};

export const DEFAULT_TEAM_PRESET_ID = 'duo';

export function getTeamPreset(teamId: string): TeamPreset | undefined {
  return TEAM_PRESETS[teamId];
}

export function listTeamPresetIds(): string[] {
  return Object.keys(TEAM_PRESETS);
}
