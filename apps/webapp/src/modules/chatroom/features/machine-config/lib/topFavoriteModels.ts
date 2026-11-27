import type { MachineConfigEntry } from '../types/machineConfig';

/** Per-role outcome of `agents.applyConfig`. */
export type ApplyConfigOutcome = 'unchanged' | 'saved' | 'restarted';

/** One role and the favourite that would be applied to it. */
export interface RoleTopFavorite {
  role: string;
  entry: MachineConfigEntry;
}

export interface ApplyTopFavoritesResult {
  applied: (RoleTopFavorite & { outcome?: ApplyConfigOutcome })[];
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

/** Outcome breakdown of applied entries in a fixed order; zero counts are omitted. */
function describeOutcomes(applied: ApplyTopFavoritesResult['applied']): string[] {
  const count = (outcome: ApplyConfigOutcome) =>
    applied.filter((entry) => entry.outcome === outcome).length;
  const parts: string[] = [];
  const restarted = count('restarted');
  if (restarted > 0) parts.push(`${restarted} restarted`);
  const saved = count('saved');
  if (saved > 0) parts.push(`${saved} saved (not running)`);
  const unchanged = count('unchanged');
  if (unchanged > 0) parts.push(`${unchanged} already up to date`);
  return parts;
}

/** Inline feedback copy for an apply result, rendered next to the control that ran the apply. */
// fallow-ignore-next-line complexity
export function describeApplyTopFavoritesResult(
  result: ApplyTopFavoritesResult
): ApplyTopFavoritesFeedback {
  const parts = describeOutcomes(result.applied);
  if (result.failed.length === 0) {
    const count = result.applied.length;
    if (count > 0 && result.applied.every((entry) => entry.outcome === 'unchanged')) {
      return { kind: 'success', message: 'Every agent already uses its top favourite model.' };
    }
    const detail = parts.length > 0 ? `: ${parts.join(', ')}` : '';
    return {
      kind: 'success',
      message: `Applied top favourite model to ${count} agent(s)${detail}.`,
    };
  }
  const failures = result.failed.map((f) => `${f.role} (${f.message})`).join(', ');
  const appliedSuffix =
    result.applied.length > 0
      ? `. Applied to ${result.applied.length} other agent(s)${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`
      : '';
  return {
    kind: 'error',
    message: `Failed to apply top favourite model for ${failures}${appliedSuffix}`,
  };
}
