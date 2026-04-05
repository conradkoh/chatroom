import type { Id } from '../_generated/dataModel';

/**
 * Convert a Convex Id to a plain string.
 *
 * Used at dependency injection boundaries where pure functions
 * accept `string` but Convex APIs return `Id<T>`.
 * Convex IDs are strings internally, so this is always safe.
 */
export function str(id: Id<any> | string): string {
  return id as string;
}
