/**
 * Team Kind — canonical definitions for well-known chatroom team types.
 *
 * The shared team-kind tuple is the domain source of truth. This backend
 * adapter derives its Zod schema, enum-like object, Convex validator, and
 * runtime guard from that tuple.
 *
 * To add or remove a team kind, update the shared team-kind tuple; all backend
 * validation shapes update automatically.
 *
 * @see docs/conventions/domain-models.md
 */

import { TEAM_PRESET_IDS, type TeamPresetId } from '@workspace/shared/domain/team-kind';
import { v } from 'convex/values';
import { z } from 'zod';

import { toLiteralValidators } from './_shared/v-literals-of';

// ─── Shared source adapter ──────────────────────────────────────────────────

export const teamKindSchema = z.enum(TEAM_PRESET_IDS);

// ─── Derived shapes ─────────────────────────────────────────────────────────

/** TS type of a well-known team kind. */
export type TeamKind = TeamPresetId;

/** Readonly tuple of all well-known team kinds — iteration order is canonical. */
export const WELL_KNOWN_TEAM_KINDS = teamKindSchema.options;

/**
 * Enum-like object: TeamKindEnum.duo === 'duo', etc.
 * Convenient for callsites that prefer member access over string literals.
 */
export const TeamKindEnum = teamKindSchema.enum;

// ─── Convex validator ───────────────────────────────────────────────────────

export const teamKindValidator = v.union(...toLiteralValidators(WELL_KNOWN_TEAM_KINDS));

// ─── Runtime guard ──────────────────────────────────────────────────────────

/** Runtime type guard: is the given value a well-known team kind? */
export const isTeamKind = (value: unknown): value is TeamKind =>
  teamKindSchema.safeParse(value).success;
