/**
 * Builds the handoff capability list used by prompt delivery.
 *
 * Configured team roles (persisted `chatroom.teamRoles`) define structural
 * handoff capability. Active waiting participants are a legacy fallback only
 * when configured membership is empty. The current role is never exposed as its
 * own target, roles are deduplicated case-insensitively (first configured
 * spelling/order wins), `user` is always available exactly once, and `enhancer`
 * remains eligibility-gated.
 */

export interface BuildAvailableHandoffRolesOptions {
  /** Persisted team membership; authoritative when non-empty. */
  teamRoles: string[];
  /** Role receiving the prompt; never expose it as its own target. */
  currentRole: string;
  /** Active waiting participant roles used only for legacy empty-membership rooms. */
  fallbackParticipantRoles: string[];
  /** Only true for the explicitly eligible user-originated entry-point flow. */
  includeEnhancer?: boolean | undefined;
}

// fallow-ignore-next-line complexity
export function buildAvailableHandoffRoles(options: BuildAvailableHandoffRolesOptions): string[] {
  const sourceRoles =
    options.teamRoles.length > 0 ? options.teamRoles : options.fallbackParticipantRoles;
  const currentRole = options.currentRole.toLowerCase();
  const seen = new Set<string>();
  const roles: string[] = [];

  // Deliberately a single linear pass over the configured/fallback membership
  // applying the required filter/dedupe/user/enhancer invariants.
  for (const role of sourceRoles) {
    const normalizedRole = role.toLowerCase();
    if (normalizedRole === 'user' || normalizedRole === currentRole || seen.has(normalizedRole)) {
      continue;
    }
    if (normalizedRole === 'enhancer' && !options.includeEnhancer) continue;
    seen.add(normalizedRole);
    roles.push(role);
  }

  if (options.includeEnhancer && !seen.has('enhancer')) {
    seen.add('enhancer');
    roles.unshift('enhancer');
  }
  if (!seen.has('user')) {
    seen.add('user');
    roles.push('user');
  }
  return roles;
}
