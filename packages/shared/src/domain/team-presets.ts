import { getAgentRoleTags, getPermanentRoleNames, type AgentRoleLifecycleTag } from './agent-role';

export interface TeamPreset {
  name: string;
  description: string;
  roles: readonly string[];
  entryPoint: string;
}

export interface TeamStructureRole {
  role: string;
  lifecycle: AgentRoleLifecycleTag;
  optional: boolean;
}

export interface TeamStructure {
  teamId: string;
  teamName: string;
  entryPoint: string;
  roles: TeamStructureRole[];
}

export const TEAM_PRESET_IDS = ['duo', 'solo'] as const;
export type TeamPresetId = (typeof TEAM_PRESET_IDS)[number];
export const DEFAULT_TEAM_PRESET_ID: TeamPresetId = 'duo';

export const TEAM_PRESETS: Record<TeamPresetId, TeamPreset> = {
  duo: {
    name: 'Duo',
    description:
      'A planner and builder working as a pair — planner is the persistent coordinator; builder runs on demand when delegated work arrives. Optional ephemeral enhancer.',
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

/** Resolves the static structure of a team, independent of runtime agent state. */
// fallow-ignore-next-line complexity
export function getTeamStructure(input: {
  teamId: string;
  teamName?: string | null;
  persistedRoles?: readonly string[] | null;
  persistedEntryPoint?: string | null;
}): TeamStructure {
  const preset = getTeamPreset(input.teamId);
  const roles = preset ? [...preset.roles] : [...(input.persistedRoles ?? [])];
  const entryPoint = preset?.entryPoint ?? input.persistedEntryPoint ?? roles[0] ?? '';

  return {
    teamId: input.teamId,
    teamName: input.teamName ?? preset?.name ?? input.teamId,
    entryPoint,
    roles: roles.map((role) => {
      const lifecycle = getAgentRoleTags(role)[0];
      return { role, lifecycle, optional: lifecycle === 'ephemeral' };
    }),
  };
}
