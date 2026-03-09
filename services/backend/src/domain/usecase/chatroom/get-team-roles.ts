/**
 * Use Case: Get Team Roles
 *
 * Pure helper for extracting team roles from a chatroom document.
 * Centralizes the fallback (`|| []`) and normalization (`.toLowerCase()`)
 * logic that was previously duplicated across messages.ts.
 */

import type { Doc } from '../../../../convex/_generated/dataModel';

export interface GetTeamRolesResult {
  /** Raw team roles as stored (original casing). */
  teamRoles: string[];
  /** Lowercased for case-insensitive comparisons. */
  normalizedTeamRoles: string[];
}

/**
 * Extract and normalize team roles from a chatroom document.
 *
 * Accepts an already-fetched chatroom document (avoids redundant DB read).
 * Returns both the raw roles and normalized (lowercased) roles.
 */
export function getTeamRolesFromChatroom(
  chatroom: Doc<'chatroom_rooms'> | null | undefined
): GetTeamRolesResult {
  const teamRoles = chatroom?.teamRoles ?? [];
  return {
    teamRoles,
    normalizedTeamRoles: teamRoles.map((r) => r.toLowerCase()),
  };
}
