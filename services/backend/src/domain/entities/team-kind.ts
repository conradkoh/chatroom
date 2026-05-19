/**
 * Team Kind — canonical definitions for well-known chatroom team types.
 *
 * ## Multi-shape pattern
 *
 * This module demonstrates the "single source of truth → derived shapes" pattern:
 *
 * 1. **Const list** (`WELL_KNOWN_TEAM_KINDS`) — iterable, used in runtime checks
 * 2. **Type** (`TeamKind`) — compile-time union, used in function signatures and interfaces
 * 3. **Enum-like object** (`TeamKindEnum`) — runtime lookup (e.g. TeamKindEnum.pair → 'pair')
 * 4. **Convex validator** (`teamKindValidator`) — for `v.union(v.literal(...))` in mutation/query args
 * 5. **Zod schema** (`teamKindSchema`) — for runtime validation outside Convex contexts
 *
 * All derived shapes trace back to the single `as const` array at the top.
 * Adding a new team kind requires exactly one edit: append to the array.
 *
 * @see docs/conventions/domain-models.md
 */

import { v } from 'convex/values';
import { z } from 'zod';

// ─── Source of truth ────────────────────────────────────────────────────────

/** Canonical list of well-known team kinds. Add new kinds here. */
export const WELL_KNOWN_TEAM_KINDS = ['pair', 'squad', 'duo', 'solo'] as const;

// ─── Derived shapes ─────────────────────────────────────────────────────────

/** Union type of well-known team kinds. */
export type TeamKind = (typeof WELL_KNOWN_TEAM_KINDS)[number];

/** Enum-like object: TeamKindEnum.pair === 'pair', etc. */
export const TeamKindEnum: Record<TeamKind, TeamKind> = Object.fromEntries(
  WELL_KNOWN_TEAM_KINDS.map((k) => [k, k])
) as Record<TeamKind, TeamKind>;

/** Convex validator for well-known team kinds.
 *  Hand-written literals because TS cannot infer the union from a mapped
 *  spread (the Convex v.literal return type is opaque).
 *  When adding a new kind, append a new v.literal(...) here.
 *  The exhaustiveness test in team-kind.spec.ts verifies consistency. */
export const teamKindValidator = v.union(
  v.literal('pair'),
  v.literal('squad'),
  v.literal('duo'),
  v.literal('solo')
);

/** Zod schema for well-known team kinds. */
export const teamKindSchema = z.enum(WELL_KNOWN_TEAM_KINDS);

// ─── Guards ─────────────────────────────────────────────────────────────────

/** Type guard: is the given string a well-known team kind? */
export function isTeamKind(value: string): value is TeamKind {
  return (WELL_KNOWN_TEAM_KINDS as readonly string[]).includes(value);
}
