import {
  getAgentRoleTags,
  getBuiltinRolesForTeam,
  getPermanentRoleNames,
  type AgentRoleLifecycleTag,
  type BuiltinTeamRole,
  type PermanentBuiltinTeamRole,
} from './agent-role';
import { TEAM_PRESET_IDS, type TeamPresetId } from './team-kind';

export { TEAM_PRESET_IDS } from './team-kind';
export type { TeamPresetId } from './team-kind';

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

export const DEFAULT_TEAM_PRESET_ID: TeamPresetId = 'duo';

export const TEAM_STRUCTURE_IDS = {
  duo: 'duo@1',
  solo: 'solo@1',
} as const satisfies Record<TeamPresetId, string>;

export type BuiltinTeamPreset<T extends TeamPresetId> = Omit<TeamPreset, 'roles' | 'entryPoint'> & {
  roles: readonly BuiltinTeamRole<T>[];
  entryPoint: PermanentBuiltinTeamRole<T>;
};

export const TEAM_PRESETS = {
  duo: {
    structureId: TEAM_STRUCTURE_IDS.duo,
    name: 'Duo',
    description:
      'A planner and builder working as a pair, planner as coordinator, with optional ephemeral architect, researcher, triage, and uiux-engineer roles',
    roles: getBuiltinRolesForTeam('duo'),
    entryPoint: 'planner',
  },
  solo: {
    structureId: TEAM_STRUCTURE_IDS.solo,
    name: 'Solo',
    description:
      'A single agent working independently, with optional ephemeral architect, triage, and uiux-engineer roles',
    roles: getBuiltinRolesForTeam('solo'),
    entryPoint: 'solo',
  },
} satisfies { [T in TeamPresetId]: BuiltinTeamPreset<T> };

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
