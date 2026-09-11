export enum AgentRoleLifecycleTag {
  Permanent = 'permanent',
  Ephemeral = 'ephemeral',
}

export const AGENT_ROLE_LIFECYCLE_TAGS = [
  AgentRoleLifecycleTag.Permanent,
  AgentRoleLifecycleTag.Ephemeral,
] as const;

export type AgentRoleDefinition = {
  role: string;
  tags: readonly AgentRoleLifecycleTag[];
};

/** Known roles have one lifecycle tag; unknown roles default to permanent. */
export const AGENT_ROLE_DEFINITIONS = {
  planner: { role: 'planner', tags: [AgentRoleLifecycleTag.Permanent] },
  builder: { role: 'builder', tags: [AgentRoleLifecycleTag.Permanent] },
  solo: { role: 'solo', tags: [AgentRoleLifecycleTag.Permanent] },
  enhancer: { role: 'enhancer', tags: [AgentRoleLifecycleTag.Ephemeral] },
} as const satisfies Record<string, AgentRoleDefinition>;

export function normalizeAgentRole(role: string): string {
  return role.trim().toLowerCase();
}

export function getAgentRoleTags(role: string): readonly AgentRoleLifecycleTag[] {
  const normalized = normalizeAgentRole(role);
  const definition = Object.values(AGENT_ROLE_DEFINITIONS).find(
    (candidate) => normalizeAgentRole(candidate.role) === normalized
  );
  return definition?.tags ?? [AgentRoleLifecycleTag.Permanent];
}

export function hasAgentRoleTag(role: string, tag: AgentRoleLifecycleTag): boolean {
  return getAgentRoleTags(role).includes(tag);
}

export function getPermanentRoleNames(roles: readonly string[]): string[] {
  return roles.filter((role) => hasAgentRoleTag(role, AgentRoleLifecycleTag.Permanent));
}

export function isEphemeralAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, AgentRoleLifecycleTag.Ephemeral);
}

export function isPermanentAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, AgentRoleLifecycleTag.Permanent);
}
