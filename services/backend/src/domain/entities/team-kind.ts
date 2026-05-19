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

import { v } from 'convex/values';
import { z } from 'zod';

import { toLiteralValidators } from './_shared/v-literals-of';

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

export const teamKindValidator = v.union(...toLiteralValidators(WELL_KNOWN_TEAM_KINDS));

// ─── Runtime guard ──────────────────────────────────────────────────────────

/** Runtime type guard: is the given value a well-known team kind? */
export const isTeamKind = (value: unknown): value is TeamKind =>
  teamKindSchema.safeParse(value).success;
