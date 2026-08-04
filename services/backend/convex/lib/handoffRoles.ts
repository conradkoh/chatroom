/** Waiting participant roles plus user (always an allowed handoff target). */
export function buildAvailableHandoffRoles(
  waitingParticipantRoles: string[],
  options?: { includeEnhancer?: boolean }
): string[] {
  const roles = [...waitingParticipantRoles, 'user'];
  if (options?.includeEnhancer && !roles.some((r) => r.toLowerCase() === 'enhancer')) {
    return ['enhancer', ...roles];
  }
  return roles;
}
