/**
 * Team Kind — canonical definitions for well-known chatroom team types.
 *
 * Uses `z.enum(...)` as the single source of truth. All other shapes
 * (type, readonly tuple, enum-like object, Convex validator, and runtime
 * guard) are derived from the zod schema.
 *
 * To add or remove a team kind, edit ONLY the `z.enum(...)` array.
 * Every derived shape updates automatically.
 *
 * @see docs/conventions/domain-models.md
 */

import { v, type VLiteral } from 'convex/values';
import { z } from 'zod';

// ─── Source of truth ────────────────────────────────────────────────────────

/**
 * Canonical zod schema for well-known team kinds — the single source of truth.
 * All other shapes in this module are derived from it.
 *
 * To add or remove a team kind, edit this list only. The type, list, enum-like
 * object, Convex validator, and runtime guard all update automatically.
 */
export const teamKindSchema = z.enum(['pair', 'squad', 'duo', 'solo']);

// ─── Derived shapes ─────────────────────────────────────────────────────────

/** TS type of a well-known team kind. */
export type TeamKind = z.infer<typeof teamKindSchema>;

/** Readonly tuple of all well-known team kinds — iteration order is canonical. */
export const WELL_KNOWN_TEAM_KINDS = teamKindSchema.options;

/**
 * Enum-like object: TeamKindEnum.pair === 'pair', etc.
 * Convenient for callsites that prefer member access over string literals.
 */
export const TeamKindEnum = teamKindSchema.enum;

// ─── Convex validator ───────────────────────────────────────────────────────

/**
 * Mapped tuple type: turns a readonly tuple of literals into the matching
 * tuple of VLiteral validators. Lets us spread a runtime-built array of
 * validators into v.union(...) while preserving each element's precise type.
 *
 * Required because Convex's v.union is variadic — passing a widened array
 * (e.g. VLiteral<TeamKind>[]) collapses the result to Validator<string>.
 */
type VLiteralsOf<T extends readonly (string | number | bigint | boolean)[]> = {
  [K in keyof T]: VLiteral<T[K], 'required'>;
};

/**
 * Convex validator for a well-known team kind. Derived from the same source
 * tuple as the type; adding a member to teamKindSchema automatically expands
 * this validator's static type. The one cast is justified because
 * .map(v.literal) produces exactly the tuple described by VLiteralsOf at runtime.
 */
export const teamKindValidator = v.union(
  ...(WELL_KNOWN_TEAM_KINDS.map((k) => v.literal(k)) as unknown as VLiteralsOf<
    typeof WELL_KNOWN_TEAM_KINDS
  >)
);

// ─── Runtime guard ──────────────────────────────────────────────────────────

/** Runtime type guard: is the given value a well-known team kind? */
export const isTeamKind = (value: unknown): value is TeamKind =>
  teamKindSchema.safeParse(value).success;
