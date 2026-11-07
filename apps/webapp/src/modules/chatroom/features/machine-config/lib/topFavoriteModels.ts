import type { MachineConfigEntry } from '../types/machineConfig';

/** One role and the favourite that would be applied to it. */
export interface RoleTopFavorite {
  role: string;
  entry: MachineConfigEntry;
}

export interface ApplyTopFavoritesResult {
  applied: RoleTopFavorite[];
  failed: { role: string; message: string }[];
}

export interface ApplyTopFavoritesFeedback {
  kind: 'success' | 'error';
  message: string;
}

/**
 * Top favourite (index 0) for each role, in `roles` order. Roles with no favourites are omitted.
 * Pure: no React or Convex imports.
 */
export function resolveTopFavoritePerRole(
  roles: readonly string[],
  favoritesByRole: ReadonlyMap<string, readonly MachineConfigEntry[]>
): RoleTopFavorite[] {
  return roles.flatMap((role) => {
    const top = favoritesByRole.get(role)?.[0];
    return top ? [{ role, entry: top }] : [];
  });
}

/** User-facing toast for an apply result. */
export function describeApplyTopFavoritesResult(
  result: ApplyTopFavoritesResult
): ApplyTopFavoritesFeedback {
  if (result.failed.length === 0) {
    return {
      kind: 'success',
      message: `Applied top favourite model to ${result.applied.length} agent(s). Restart agents to use it.`,
    };
  }
  const failures = result.failed.map((f) => `${f.role} (${f.message})`).join(', ');
  const appliedSuffix =
    result.applied.length > 0 ? `. Applied to ${result.applied.length} other agent(s).` : '';
  return {
    kind: 'error',
    message: `Failed to apply top favourite model for ${failures}${appliedSuffix}`,
  };
}
