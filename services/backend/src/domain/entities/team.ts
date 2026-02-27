/**
 * Team entity helpers
 *
 * Pure functions for working with team configuration data.
 * These are domain-level utilities with no Convex dependencies.
 */

/**
 * Returns the entry point role for a team.
 *
 * Priority:
 *   1. Explicitly configured `teamEntryPoint`
 *   2. First element of `teamRoles` (fallback)
 *   3. `null` if neither is available
 *
 * @example
 * getTeamEntryPoint({ teamEntryPoint: 'planner', teamRoles: ['planner', 'builder'] })
 * // → 'planner'
 *
 * getTeamEntryPoint({ teamRoles: ['builder', 'reviewer'] })
 * // → 'builder'
 *
 * getTeamEntryPoint({})
 * // → null
 */
export function getTeamEntryPoint(team: {
  teamEntryPoint?: string | null;
  teamRoles?: string[] | null;
}): string | null {
  return team.teamEntryPoint ?? team.teamRoles?.[0] ?? null;
}
