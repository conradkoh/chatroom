export const AGENT_ROLE_LIFECYCLE_TAGS = ['permanent', 'ephemeral'] as const;
export type AgentRoleLifecycleTag = (typeof AGENT_ROLE_LIFECYCLE_TAGS)[number];

export type AgentRoleDefinition = {
  role: string;
  tags: readonly AgentRoleLifecycleTag[];
};

/** Known roles have one lifecycle tag; unknown roles default to permanent. */
export const AGENT_ROLE_DEFINITIONS = {
  planner: { role: 'planner', tags: ['permanent'] },
  builder: { role: 'builder', tags: ['permanent'] },
  solo: { role: 'solo', tags: ['permanent'] },
  enhancer: { role: 'enhancer', tags: ['ephemeral'] },
} as const satisfies Record<string, AgentRoleDefinition>;

export function normalizeAgentRole(role: string): string {
  return role.trim().toLowerCase();
}

export function getAgentRoleTags(role: string): readonly AgentRoleLifecycleTag[] {
  const normalized = normalizeAgentRole(role);
  const definition = Object.values(AGENT_ROLE_DEFINITIONS).find(
    (candidate) => normalizeAgentRole(candidate.role) === normalized
  );
  return definition?.tags ?? ['permanent'];
}

export function hasAgentRoleTag(role: string, tag: AgentRoleLifecycleTag): boolean {
  return getAgentRoleTags(role).includes(tag);
}

export function getPermanentRoleNames(roles: readonly string[]): string[] {
  return roles.filter((role) => hasAgentRoleTag(role, 'permanent'));
}

export function isEphemeralAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, 'ephemeral');
}

export function isPermanentAgentRole(role: string): boolean {
  return hasAgentRoleTag(role, 'permanent');
}
