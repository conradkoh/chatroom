/**
 * Project root path planning for a machine.
 *
 * Project roots are the directories a machine has opted into ("scan these trees").
 * Roots never nest: a new root replaces the children it contains, and a root inside
 * an existing root is rejected. This module is pure so the rules are testable
 * without a database.
 */

/** Maximum project roots per machine. */
export const MAX_PROJECT_ROOTS = 20;

/**
 * True when `candidate` equals `parent` or lies below it.
 *
 * The trailing `/` in the prefix check keeps siblings that merely share a prefix
 * apart: `/a/foobar` is NOT inside `/a/fo`.
 *
 * Comparison is case-sensitive. On case-insensitive filesystems (macOS default)
 * `/Users/me/Src` and `/Users/me/src` are the same directory but are treated as
 * distinct roots here; that is a known limitation, accepted because paths originate
 * from the daemon's own filesystem listing.
 */
export function isSameOrNestedPath(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

export type RootAdditionPlan =
  | { kind: 'duplicate' }
  | { kind: 'nested_in_existing'; parent: string }
  | { kind: 'add'; collapse: string[] }; // existing roots the new root contains (sorted)

/**
 * Decide what adding `candidate` means for the machine's current roots.
 *
 * Order matters: an exact match is reported as a duplicate before nesting, and an
 * addition that contains existing roots reports them as `collapse` (sorted) so the
 * caller can delete them in the same transaction.
 */
export function planRootAddition(existing: readonly string[], candidate: string): RootAdditionPlan {
  if (existing.includes(candidate)) return { kind: 'duplicate' };
  const parent = existing.find((root) => isSameOrNestedPath(candidate, root));
  if (parent !== undefined) return { kind: 'nested_in_existing', parent };
  const collapse = existing.filter((root) => isSameOrNestedPath(root, candidate)).sort();
  return { kind: 'add', collapse };
}
