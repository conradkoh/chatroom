/** Machine-scoped favorite key: team + role only (no chatroom). */
export function buildMachineFavoriteScopeKey(teamId: string, role: string): string {
  return `team_${teamId.toLowerCase()}#role_${role.toLowerCase()}`;
}

const LEGACY_SCOPE_PATTERN = /^chatroom_[^#]+#(team_[^#]+#role_[^#]+)$/;

/** Extract machine-scoped key from legacy chatroom-prefixed key, or return key if already new format. */
export function normalizeMachineFavoriteScopeKey(teamRoleKey: string): string {
  if (teamRoleKey.startsWith('team_')) return teamRoleKey;
  const match = teamRoleKey.match(LEGACY_SCOPE_PATTERN);
  if (match) return match[1];
  return teamRoleKey;
}

export function isLegacyMachineFavoriteScopeKey(teamRoleKey: string): boolean {
  return teamRoleKey.startsWith('chatroom_');
}
