import { TEAM_PRESET_IDS, type TeamPresetId } from './team-kind';

export enum AgentRoleLifecycleTag {
  Permanent = 'permanent',
  Ephemeral = 'ephemeral',
}

export const AGENT_ROLE_LIFECYCLE_TAGS = [
  AgentRoleLifecycleTag.Permanent,
  AgentRoleLifecycleTag.Ephemeral,
] as const;

export interface AgentRoleTeamMembership {
  readonly teamId: TeamPresetId;
  readonly order: number;
}

export interface AgentRoleMetadata {
  readonly tags: readonly [AgentRoleLifecycleTag];
  readonly teams: readonly [AgentRoleTeamMembership, ...AgentRoleTeamMembership[]];
}

/** The sole authored source for builtin role lifecycle and team membership. */
const roleMetadata = {
  planner: {
    tags: [AgentRoleLifecycleTag.Permanent],
    teams: [{ teamId: 'duo', order: 10 }],
  },
  builder: {
    tags: [AgentRoleLifecycleTag.Permanent],
    teams: [{ teamId: 'duo', order: 50 }],
  },
  solo: {
    tags: [AgentRoleLifecycleTag.Permanent],
    teams: [{ teamId: 'solo', order: 10 }],
  },
  architect: {
    tags: [AgentRoleLifecycleTag.Ephemeral],
    teams: [
      { teamId: 'duo', order: 20 },
      { teamId: 'solo', order: 20 },
    ],
  },
  triage: {
    tags: [AgentRoleLifecycleTag.Ephemeral],
    teams: [
      { teamId: 'duo', order: 30 },
      { teamId: 'solo', order: 30 },
    ],
  },
  'uiux-engineer': {
    tags: [AgentRoleLifecycleTag.Ephemeral],
    teams: [
      { teamId: 'duo', order: 40 },
      { teamId: 'solo', order: 40 },
    ],
  },
} as const satisfies Record<string, AgentRoleMetadata>;

export type BuiltinAgentRole = keyof typeof roleMetadata;
export type KnownAgentRole = BuiltinAgentRole;
export type AgentRoleDefinition<R extends string = string> = Readonly<{ role: R }> &
  AgentRoleMetadata;
export type BuiltinAgentRoleDefinitions = {
  readonly [R in BuiltinAgentRole]: Readonly<{ role: R }> & (typeof roleMetadata)[R];
};
export type BuiltinTeamRole<T extends TeamPresetId> = {
  [R in BuiltinAgentRole]: Extract<
    (typeof roleMetadata)[R]['teams'][number],
    { teamId: T }
  > extends never
    ? never
    : R;
}[BuiltinAgentRole];
export type PermanentBuiltinTeamRole<T extends TeamPresetId> = {
  [
    R in BuiltinTeamRole<T>
  ]: (typeof roleMetadata)[R]['tags'][0] extends AgentRoleLifecycleTag.Permanent ? R : never;
}[BuiltinTeamRole<T>];

// Object.fromEntries loses the key/value correlation retained by roleMetadata.
export const AGENT_ROLE_DEFINITIONS: BuiltinAgentRoleDefinitions = Object.fromEntries(
  Object.entries(roleMetadata).map(([role, metadata]) => [role, { role, ...metadata }])
) as BuiltinAgentRoleDefinitions;

/** Exact canonical-key guard; callers normalize separately when appropriate. */
export function isBuiltinAgentRole(role: string): role is BuiltinAgentRole {
  return Object.prototype.hasOwnProperty.call(roleMetadata, role);
}

/** Returns builtin roles for a team in their explicitly authored order. */
export function getBuiltinRolesForTeam<T extends TeamPresetId>(
  teamId: T
): readonly BuiltinTeamRole<T>[] {
  const memberships = Object.values(AGENT_ROLE_DEFINITIONS).flatMap((definition) => {
    const membership = definition.teams.find((entry) => entry.teamId === teamId);
    return membership ? [{ role: definition.role, order: membership.order }] : [];
  });
  const roles = memberships.sort((left, right) => left.order - right.order).map(({ role }) => role);

  // Filtering the declared membership list narrows to the team-specific key union.
  return roles as BuiltinTeamRole<T>[];
}

export function normalizeAgentRole(role: string): string {
  return role.trim().toLowerCase();
}

/** Exact legacy role name that is no longer available for new configuration. */
export function isRetiredAgentRole(role: string): boolean {
  return normalizeAgentRole(role) === 'enhancer';
}

function validateNormalizedRoleName(role: string): string {
  const normalizedRole = normalizeAgentRole(role);
  if (normalizedRole.length === 0 || role !== normalizedRole) {
    throw new Error(`Agent role "${role}" must have a normalized nonempty name`);
  }
  return normalizedRole;
}

function validateRoleNotReserved(role: string, normalizedRole: string): void {
  if (normalizedRole === 'user' || normalizedRole === 'enhancer') {
    throw new Error(`Agent role "${role}" is reserved or retired`);
  }
}

function registerUniqueRoleName(
  role: string,
  normalizedRole: string,
  roleNames: Set<string>
): void {
  if (roleNames.has(normalizedRole)) {
    throw new Error(`Agent role "${role}" duplicates normalized role "${normalizedRole}"`);
  }
  roleNames.add(normalizedRole);
}

function validateRoleName(role: string, roleNames: Set<string>): void {
  const normalizedRole = validateNormalizedRoleName(role);
  validateRoleNotReserved(role, normalizedRole);
  registerUniqueRoleName(role, normalizedRole, roleNames);
}

function validateRoleLifecycle(definition: AgentRoleDefinition): void {
  const { role } = definition;
  if (
    !Array.isArray(definition.tags) ||
    definition.tags.length !== 1 ||
    !AGENT_ROLE_LIFECYCLE_TAGS.includes(definition.tags[0])
  ) {
    throw new Error(`Agent role "${role}" must declare exactly one recognized lifecycle tag`);
  }
}

function validateKnownTeam(role: string, teamId: TeamPresetId): void {
  if (!TEAM_PRESET_IDS.some((knownTeamId) => knownTeamId === teamId)) {
    throw new Error(`Agent role "${role}" has unknown team "${String(teamId)}"`);
  }
}

function validateUniqueRoleMembership(
  role: string,
  teamId: TeamPresetId,
  membershipsForRole: Set<TeamPresetId>
): void {
  if (membershipsForRole.has(teamId)) {
    throw new Error(`Agent role "${role}" has duplicate membership in team "${teamId}"`);
  }
  membershipsForRole.add(teamId);
}

function validateMembershipOrder(role: string, teamId: TeamPresetId, order: number): void {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new Error(
      `Agent role "${role}" has invalid order "${String(order)}" for team "${teamId}"`
    );
  }
}

function registerUniqueTeamOrder(
  role: string,
  teamId: TeamPresetId,
  order: number,
  teamOrders: Map<TeamPresetId, Map<number, string>>
): void {
  const orders = teamOrders.get(teamId) ?? new Map<number, string>();
  const conflictingRole = orders.get(order);
  if (conflictingRole !== undefined) {
    throw new Error(
      `Agent role "${role}" order ${order} for team "${teamId}" conflicts with role "${conflictingRole}"`
    );
  }
  orders.set(order, role);
  teamOrders.set(teamId, orders);
}

function validateMembership(
  role: string,
  membership: AgentRoleTeamMembership,
  membershipsForRole: Set<TeamPresetId>,
  teamOrders: Map<TeamPresetId, Map<number, string>>
): void {
  const { teamId, order } = membership;
  validateKnownTeam(role, teamId);
  validateUniqueRoleMembership(role, teamId, membershipsForRole);
  validateMembershipOrder(role, teamId, order);
  registerUniqueTeamOrder(role, teamId, order, teamOrders);
}

function validateRoleMemberships(
  definition: AgentRoleDefinition,
  teamOrders: Map<TeamPresetId, Map<number, string>>
): void {
  const { role, teams } = definition;
  if (!Array.isArray(teams) || teams.length === 0) {
    throw new Error(`Agent role "${role}" must declare at least one team membership`);
  }

  const membershipsForRole = new Set<TeamPresetId>();
  for (const membership of teams) {
    validateMembership(role, membership, membershipsForRole, teamOrders);
  }
}

/** Validates runtime data at the authored metadata boundary. */
export function validateAgentRoleDefinitions(definitions: readonly AgentRoleDefinition[]): void {
  const roleNames = new Set<string>();
  const teamOrders = new Map<TeamPresetId, Map<number, string>>();
  for (const definition of definitions) {
    validateRoleName(definition.role, roleNames);
    validateRoleLifecycle(definition);
    validateRoleMemberships(definition, teamOrders);
  }
}

validateAgentRoleDefinitions(Object.values(AGENT_ROLE_DEFINITIONS));

/** Known roles have one lifecycle tag; unknown roles default to permanent. */
export function getAgentRoleTags(role: string): readonly [AgentRoleLifecycleTag] {
  const normalized = normalizeAgentRole(role);
  return isBuiltinAgentRole(normalized)
    ? AGENT_ROLE_DEFINITIONS[normalized].tags
    : [AgentRoleLifecycleTag.Permanent];
}

export function hasAgentRoleTag(role: string, tag: AgentRoleLifecycleTag): boolean {
  return getAgentRoleTags(role).includes(tag);
}

export function getPermanentRoleNames(roles: readonly string[]): string[] {
  return roles.filter(
    (role) => !isRetiredAgentRole(role) && hasAgentRoleTag(role, AgentRoleLifecycleTag.Permanent)
  );
}

export function isEphemeralAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, AgentRoleLifecycleTag.Ephemeral);
}

export function isPermanentAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, AgentRoleLifecycleTag.Permanent);
}
