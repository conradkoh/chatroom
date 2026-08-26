import { getPermanentRoleNames } from './agent-role';

export interface TeamPreset {
  name: string;
  description: string;
  roles: readonly string[];
  entryPoint: string;
}

export const TEAM_PRESET_IDS = ['duo', 'solo'] as const;
export type TeamPresetId = (typeof TEAM_PRESET_IDS)[number];
export const DEFAULT_TEAM_PRESET_ID: TeamPresetId = 'duo';

export const TEAM_PRESETS: Record<TeamPresetId, TeamPreset> = {
  duo: {
    name: 'Duo',
    description:
      'A planner and builder working as a pair, planner as coordinator, with optional ephemeral enhancer',
    roles: ['planner', 'enhancer', 'builder'],
    entryPoint: 'planner',
  },
  solo: {
    name: 'Solo',
    description: 'A single agent working independently, with optional ephemeral enhancer',
    roles: ['solo', 'enhancer'],
    entryPoint: 'solo',
  },
};

export function getTeamPreset(teamId: string): TeamPreset | undefined {
  const normalized = teamId.trim().toLowerCase();
  return normalized === 'duo' || normalized === 'solo' ? TEAM_PRESETS[normalized] : undefined;
}

export function listTeamPresetIds(): TeamPresetId[] {
  return [...TEAM_PRESET_IDS];
}

export function getPermanentRolesForPreset(teamId: TeamPresetId): readonly string[] {
  return getPermanentRoleNames(TEAM_PRESETS[teamId].roles);
}
