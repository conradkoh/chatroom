/**
 * Builds a unique key scoped to chatroom+team+role.
 * Must match services/backend/convex/utils/teamRoleKey.ts exactly.
 */
export function buildTeamRoleKey(chatroomId: string, teamId: string, role: string): string {
  return `chatroom_${chatroomId}#team_${teamId.toLowerCase()}#role_${role.toLowerCase()}`;
}

export function buildMachineConfigScopeKey(
  machineId: string,
  chatroomId: string,
  teamId: string,
  role: string
): string {
  return `${machineId}|${buildTeamRoleKey(chatroomId, teamId, role)}`;
}
