/**
 * Team entity and helpers
 *
 * Pure functions and types for working with team configuration data.
 * These are domain-level utilities with no Convex dependencies.
 */

// ─── Entity ───────────────────────────────────────────────────────────────────

/**
 * Team domain entity.
 *
 * Represents a fully resolved team configuration. Unlike the raw chatroom
 * document (where fields are all optional), a `Team` guarantees that
 * `id`, `name`, `roles`, and `entryPoint` are all present.
 *
 * Use `toTeam()` to create a `Team` from a chatroom document.
 */
export interface Team {
  /** Template identifier — e.g. 'duo', 'pair', 'squad' */
  id: string;
  /** Human-readable display name — e.g. 'Duo Team' */
  name: string;
  /** All roles in this team — e.g. ['planner', 'builder'] */
  roles: string[];
  /**
   * The role that receives user messages and coordinates the team.
   * Resolved from teamEntryPoint if set; otherwise falls back to roles[0].
   */
  entryPoint: string;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates a `Team` entity from a raw chatroom-like object.
 *
 * Returns `null` if the minimum required fields (`teamId` and `teamRoles`)
 * are not present — a chatroom without team configuration is valid (e.g.
 * legacy chatrooms), but cannot produce a `Team` entity.
 *
 * @example
 * toTeam({ teamId: 'duo', teamName: 'Duo', teamRoles: ['planner', 'builder'], teamEntryPoint: 'planner' })
 * // → { id: 'duo', name: 'Duo', roles: ['planner', 'builder'], entryPoint: 'planner' }
 *
 * toTeam({ teamId: 'pair', teamRoles: ['builder', 'reviewer'] })
 * // → { id: 'pair', name: 'pair', roles: ['builder', 'reviewer'], entryPoint: 'builder' }
 *
 * toTeam({})
 * // → null
 */
export function toTeam(chatroom: {
  teamId?: string | null;
  teamName?: string | null;
  teamRoles?: string[] | null;
  teamEntryPoint?: string | null;
}): Team | null {
  if (!chatroom.teamId || !chatroom.teamRoles || chatroom.teamRoles.length === 0) {
    return null;
  }
  const entryPoint = chatroom.teamEntryPoint ?? chatroom.teamRoles[0];
  if (!entryPoint) return null;
  return {
    id: chatroom.teamId,
    name: chatroom.teamName ?? chatroom.teamId,
    roles: chatroom.teamRoles,
    entryPoint,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Returns whether the given role is the entry point for the team.
 */
export function isEntryPoint(team: Team, role: string): boolean {
  return team.entryPoint.toLowerCase() === role.toLowerCase();
}
