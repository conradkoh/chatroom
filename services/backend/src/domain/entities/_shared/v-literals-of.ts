/**
 * Mapped tuple type and runtime helper for building precisely-typed
 * Convex unions of literals from a readonly tuple.
 *
 * Convex's `v.union(...members)` is variadic — passing a widened array
 * (e.g. `VLiteral<'a' | 'b'>[]`) collapses the result to `Validator<string>`.
 * This helper preserves the literal-union type through `v.union(...)`.
 *
 * @see docs/conventions/domain-models.md
 *
 * @example
 * ```ts
 * const KINDS = ['a', 'b', 'c'] as const;
 * const validator = v.union(...toLiteralValidators(KINDS));
 * // → VUnion<'a' | 'b' | 'c', ...>
 * ```
 */

import { v, type VLiteral } from 'convex/values';

export type VLiteralsOf<T extends readonly (string | number | bigint | boolean)[]> = {
  [K in keyof T]: VLiteral<T[K], 'required'>;
};

/** Maps a readonly literal tuple to the matching tuple of VLiteral validators
 *  with precise types preserved. */
export const toLiteralValidators = <
  T extends readonly (string | number | bigint | boolean)[],
>(values: T): VLiteralsOf<T> =>
  values.map((v_) => v.literal(v_)) as unknown as VLiteralsOf<T>;
