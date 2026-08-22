const ENHANCER_ENTRY_POINT_BY_TEAM: Readonly<Record<string, string>> = {
  duo: 'planner',
  solo: 'solo',
};

export interface EnhancerTeamLike {
  teamId?: string | null;
  teamEntryPoint?: string | null;
  teamRoles?: readonly string[] | null;
}

export function getSupportedEnhancerEntryPointRole(
  teamId: string | null | undefined
): string | null {
  if (!teamId) return null;
  return ENHANCER_ENTRY_POINT_BY_TEAM[teamId.toLowerCase()] ?? null;
}

export function isSupportedEnhancerRole(teamId: string | null | undefined, role: string): boolean {
  return getSupportedEnhancerEntryPointRole(teamId) === role.toLowerCase();
}

/** True when the selected team contains its supported enhancer-owning role. */
export function teamSupportsEnhancer(team: EnhancerTeamLike): boolean {
  const supportedEntryPoint = getSupportedEnhancerEntryPointRole(team.teamId);
  return (
    supportedEntryPoint !== null &&
    (team.teamRoles ?? []).some((role) => role.toLowerCase() === supportedEntryPoint)
  );
}

function getConfiguredEntryPoint(team: EnhancerTeamLike): string | null {
  return team.teamEntryPoint ?? team.teamRoles?.[0] ?? null;
}

/**
 * Returns the persistent role that owns enhancer input for a valid team.
 * The enhancer is transient and must return work to the configured entry point.
 */
export function getEnhancerEntryPointRole(team: EnhancerTeamLike): string | null {
  const configuredEntryPoint = getConfiguredEntryPoint(team);
  return configuredEntryPoint !== null &&
    teamSupportsEnhancer(team) &&
    isSupportedEnhancerRole(team.teamId, configuredEntryPoint)
    ? configuredEntryPoint
    : null;
}

export function isEnhancerEntryPointRole(team: EnhancerTeamLike, role: string): boolean {
  const entryPoint = getEnhancerEntryPointRole(team);
  return entryPoint !== null && entryPoint.toLowerCase() === role.toLowerCase();
}
