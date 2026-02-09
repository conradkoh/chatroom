/**
 * Role Hierarchy System
 *
 * Defines priority ordering for agent roles in the chatroom system.
 * Lower numbers indicate higher priority (e.g., manager=1 is highest priority).
 */

export interface RoleHierarchy {
  [role: string]: number;
}

/**
 * Default role hierarchy for common agent roles.
 * Custom roles not in this list get a default priority of 100.
 */
export const DEFAULT_ROLE_HIERARCHY: RoleHierarchy = {
  planner: 0, // Planner is highest priority (squad team coordinator)
  manager: 1,
  architect: 2,
  builder: 3,
  'frontend-designer': 4,
  reviewer: 5,
  tester: 6,
  user: 999, // User is always lowest priority
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
