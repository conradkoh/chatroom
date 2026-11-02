/**
 * Identity helpers for derived timeline data.
 *
 * Convex subscriptions hand back a fresh document tree on every update, so
 * `toMessage()` allocates a new `Message` even when nothing about that row
 * changed. Derived `TimelineEvent`s then allocate on top of that, which defeats
 * `memo` on every timeline row and makes each update O(N).
 *
 * These helpers let the conversation feed swap a fresh-but-equal object back
 * for the previous reference, so only rows whose data actually changed re-render.
 */

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Compares records key-for-key, delegating value comparison to `isEqual`. */
function recordsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  isEqual: (left: unknown, right: unknown) => boolean
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => isEqual(a[key], b[key]));
}

/**
 * Compares two plain records by own enumerable keys using `Object.is`.
 * Nested values are compared by reference — use {@link structurallyEqual} when
 * nested arrays/objects are rebuilt on every update.
 */
export function shallowEqualRecord<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  return recordsEqual(a, b, Object.is);
}

/**
 * Structural equality for JSON-shaped data.
 *
 * Necessary because served messages rebuild nested collections (for example
 * `attachedTasks`) on every query run, so a top-level shallow compare of two
 * `Message`s never matches even when every field is equal.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return arraysEqual(a, b);
  return plainRecordsEqual(a, b);
}

function arraysEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => structurallyEqual(item, b[index]));
}

function plainRecordsEqual(a: unknown, b: unknown): boolean {
  if (!isPlainRecord(a) || !isPlainRecord(b)) return false;
  return recordsEqual(a, b, structurallyEqual);
}
