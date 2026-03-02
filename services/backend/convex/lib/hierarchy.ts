/** Priority ordering for agent roles; lower numbers = higher priority. */

export interface RoleHierarchy {
  [role: string]: number;
}

/** Default priority map for built-in roles; unknown roles default to 100. */
export const DEFAULT_ROLE_HIERARCHY: RoleHierarchy = {
  planner: 0,
  builder: 1,
  reviewer: 2,
  user: 999,
};

/**
 * Get the priority number for a role.
 * Returns 100 for unknown roles.
 */
export function getRolePriority(role: string): number {
  const normalizedRole = role.toLowerCase();
  return DEFAULT_ROLE_HIERARCHY[normalizedRole] ?? 100;
}

/**
 * Compare two roles by priority.
 * Returns negative if roleA has higher priority (lower number).
 */
export function compareRoles(roleA: string, roleB: string): number {
  return getRolePriority(roleA) - getRolePriority(roleB);
}

/**
 * Sort an array of roles by priority (highest priority first).
 */
export function sortRolesByPriority(roles: string[]): string[] {
  return [...roles].sort(compareRoles);
}

/**
 * Get the highest priority role from a list.
 */
export function getHighestPriorityRole(roles: string[]): string | null {
  if (roles.length === 0) return null;
  return sortRolesByPriority(roles)[0] ?? null;
}
