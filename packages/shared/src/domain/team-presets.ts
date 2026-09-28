import { getAgentRoleTags, getPermanentRoleNames, type AgentRoleLifecycleTag } from './agent-role';

export interface TeamPreset {
  /** Immutable identifier for this structural definition. */
  structureId: string;
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
  /** Immutable versioned identifier for the resolved structure. */
  teamStructureId: string;
  teamName: string;
  entryPoint: string;
  roles: TeamStructureRole[];
}

export const TEAM_PRESET_IDS = ['duo', 'solo'] as const;
export type TeamPresetId = (typeof TEAM_PRESET_IDS)[number];
export const DEFAULT_TEAM_PRESET_ID: TeamPresetId = 'duo';

export const TEAM_STRUCTURE_IDS: Record<TeamPresetId, string> = {
  duo: 'duo@1',
  solo: 'solo@1',
};

export const TEAM_PRESETS: Record<TeamPresetId, TeamPreset> = {
  duo: {
    structureId: TEAM_STRUCTURE_IDS.duo,
    name: 'Duo',
    description:
      'A planner and builder working as a pair, planner as coordinator, with optional ephemeral architect and optional ephemeral uiux-engineer roles',
    roles: ['planner', 'architect', 'uiux-engineer', 'builder'],
    entryPoint: 'planner',
  },
  solo: {
    structureId: TEAM_STRUCTURE_IDS.solo,
    name: 'Solo',
    description:
      'A single agent working independently, with optional ephemeral architect and optional ephemeral uiux-engineer roles',
    roles: ['solo', 'architect', 'uiux-engineer'],
    entryPoint: 'solo',
  },
};

/** Resolves legacy and versioned identifiers to the canonical preset kind. */
export function getTeamPresetId(teamId: string): TeamPresetId | undefined {
  const normalized = teamId.trim().toLowerCase();
  if (normalized === 'duo' || normalized === TEAM_STRUCTURE_IDS.duo) return 'duo';
  if (normalized === 'solo' || normalized === TEAM_STRUCTURE_IDS.solo) return 'solo';
  return undefined;
}

/** Returns the immutable structure identifier for a known preset. */
export function getTeamStructureId(teamId: string): string {
  const presetId = getTeamPresetId(teamId);
  return presetId ? TEAM_STRUCTURE_IDS[presetId] : teamId.trim();
}

export function getTeamPreset(teamId: string): TeamPreset | undefined {
  const presetId = getTeamPresetId(teamId);
  return presetId ? TEAM_PRESETS[presetId] : undefined;
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
    teamId: getTeamPresetId(input.teamId) ?? input.teamId,
    teamStructureId: getTeamStructureId(input.teamId),
    teamName: input.teamName ?? preset?.name ?? input.teamId,
    entryPoint,
    roles: roles.map((role) => {
      const lifecycle = getAgentRoleTags(role)[0];
      return { role, lifecycle, optional: lifecycle === 'ephemeral' };
    }),
  };
}
