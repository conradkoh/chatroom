/** Machine-scoped favorite key (shared across chatrooms on same machine). */
export function buildMachineFavoriteScopeKey(teamId: string, role: string): string {
  return `team_${teamId.toLowerCase()}#role_${role.toLowerCase()}`;
}

export function buildMachineConfigScopeKey(
  machineId: string,
  teamId: string,
  role: string
): string {
  return `${machineId}|${buildMachineFavoriteScopeKey(teamId, role)}`;
}
