import {
  getAgentRoleTags,
  getBuiltinRolesForTeam,
  getPermanentRoleNames,
  normalizeAgentRole,
  type AgentRoleLifecycleTag,
  type BuiltinTeamRole,
  type PermanentBuiltinTeamRole,
} from './agent-role';
import type { TaskSessionPolicy } from './task-envelope';
import { TEAM_PRESET_IDS, type TeamPresetId } from './team-kind';

export { TEAM_PRESET_IDS } from './team-kind';
export type { TeamPresetId } from './team-kind';

/** Whether handoffs must follow the role handoff contracts. */
export type TeamHandoffGraphPolicy = 'advisory' | 'enforced';

/**
 * Session policy a handoff edge imposes on the task it creates.
 *
 * First matching rule wins; `from: '*'` matches any sender. Unmatched edges
 * inherit the sender task's envelope policy.
 */
export interface TeamHandoffSessionRule {
  readonly from: string;
  readonly to: string;
  readonly sessionPolicy: TaskSessionPolicy;
}

export interface TeamPreset {
  /** Immutable identifier for this structural definition. */
  structureId: string;
  name: string;
  description: string;
  roles: readonly string[];
  entryPoint: string;
  /** 'enforced': the backend rejects handoffs outside the role contracts and prompts advertise only contract targets. */
  handoffGraph: TeamHandoffGraphPolicy;
  /** Per-edge session policy overrides, in first-match-wins order. */
  handoffSessionRules: readonly TeamHandoffSessionRule[];
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
  trio: 'trio@1',
} as const satisfies Record<TeamPresetId, string>;

export type BuiltinTeamPreset<T extends TeamPresetId> = Omit<
  TeamPreset,
  'roles' | 'entryPoint' | 'handoffSessionRules'
> & {
  roles: readonly BuiltinTeamRole<T>[];
  entryPoint: PermanentBuiltinTeamRole<T>;
  handoffSessionRules: readonly {
    from: BuiltinTeamRole<T> | '*';
    to: BuiltinTeamRole<T>;
    sessionPolicy: TaskSessionPolicy;
  }[];
};

export const TEAM_PRESETS = {
  duo: {
    structureId: TEAM_STRUCTURE_IDS.duo,
    name: 'Duo',
    description:
      'A planner and builder working as a pair, planner as coordinator, with optional ephemeral architect, researcher, triage, reviewer, uiux-engineer, game-asset-designer, and verifier roles',
    roles: getBuiltinRolesForTeam('duo'),
    entryPoint: 'planner',
    handoffGraph: 'advisory',
    handoffSessionRules: [],
  },
  solo: {
    structureId: TEAM_STRUCTURE_IDS.solo,
    name: 'Solo',
    description:
      'A single agent working independently, with optional ephemeral architect, triage, uiux-engineer, and verifier roles',
    roles: getBuiltinRolesForTeam('solo'),
    entryPoint: 'solo',
    handoffGraph: 'advisory',
    handoffSessionRules: [],
  },
  trio: {
    structureId: TEAM_STRUCTURE_IDS.trio,
    name: 'Trio',
    description:
      'A coordinator, specifier, and builder: the coordinator owns the user conversation and routes all work, the specifier turns plans into code-level builder briefs, with optional ephemeral architect, researcher, triage, reviewer, uiux-engineer, game-asset-designer, and verifier roles',
    roles: getBuiltinRolesForTeam('trio'),
    entryPoint: 'coordinator',
    handoffGraph: 'enforced',
    handoffSessionRules: [
      { from: 'coordinator', to: 'specifier', sessionPolicy: 'new' },
      { from: 'builder', to: 'specifier', sessionPolicy: 'continue' },
      { from: 'specifier', to: 'builder', sessionPolicy: 'new' },
      { from: '*', to: 'coordinator', sessionPolicy: 'continue' },
    ],
  },
} satisfies { [T in TeamPresetId]: BuiltinTeamPreset<T> };

/** Resolves legacy and versioned identifiers to the canonical preset kind. */
export function getTeamPresetId(teamId: string): TeamPresetId | undefined {
  const normalized = teamId.trim().toLowerCase();
  return TEAM_PRESET_IDS.find((id) => normalized === id || normalized === TEAM_STRUCTURE_IDS[id]);
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

/**
 * Session policy a handoff imposes on the task it creates.
 *
 * Returns `undefined` when the team is unknown or no rule matches, meaning the
 * new task inherits the sender task's envelope policy. Matches roles
 * case-insensitively; alias/versioned team ids such as `trio@1` resolve.
 */
export function getHandoffSessionPolicy(
  teamId: string,
  fromRole: string,
  toRole: string
): TaskSessionPolicy | undefined {
  const preset = getTeamPreset(teamId);
  if (!preset) return undefined;
  const from = normalizeAgentRole(fromRole);
  const to = normalizeAgentRole(toRole);
  return preset.handoffSessionRules.find(
    (rule) => rule.to === to && (rule.from === from || rule.from === '*')
  )?.sessionPolicy;
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
