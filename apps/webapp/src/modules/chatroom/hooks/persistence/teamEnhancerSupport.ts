function rolesInclude(teamRoles: readonly string[], role: string): boolean {
  const needle = role.toLowerCase();
  return teamRoles.some((r) => r.toLowerCase() === needle);
}

export function teamSupportsEnhancer(teamRoles: readonly string[]): boolean {
  return rolesInclude(teamRoles, 'planner');
}
