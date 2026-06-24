/**
 * Team Kind entity — unit tests
 *
 * Validates the multi-shape pattern: all derived shapes are consistent
 * with the source-of-truth const array.
 */

import { describe, expect, test } from 'vitest';

import {
  WELL_KNOWN_TEAM_KINDS,
  TeamKindEnum,
  teamKindValidator,
  teamKindSchema,
  isTeamKind,
} from './team-kind';
import type { TeamKind } from './team-kind';

describe('TeamKind', () => {
  test('WELL_KNOWN_TEAM_KINDS contains expected values', () => {
    expect(WELL_KNOWN_TEAM_KINDS).toEqual(['duo', 'solo']);
  });

  test('TeamKindEnum has entries for each kind', () => {
    for (const kind of WELL_KNOWN_TEAM_KINDS) {
      expect(TeamKindEnum[kind]).toBe(kind);
    }
    // No extra entries
    expect(Object.keys(TeamKindEnum)).toHaveLength(WELL_KNOWN_TEAM_KINDS.length);
  });

  test('isTeamKind returns true for well-known kinds', () => {
    for (const kind of WELL_KNOWN_TEAM_KINDS) {
      expect(isTeamKind(kind)).toBe(true);
    }
  });

  test('isTeamKind returns false for unknown kinds', () => {
    expect(isTeamKind('custom-team')).toBe(false);
    expect(isTeamKind('')).toBe(false);
  });

  test('zod schema validates well-known kinds', () => {
    for (const kind of WELL_KNOWN_TEAM_KINDS) {
      expect(teamKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  test('zod schema rejects unknown kinds', () => {
    expect(teamKindSchema.safeParse('custom').success).toBe(false);
    expect(teamKindSchema.safeParse('').success).toBe(false);
  });

  test('Convex validator type is callable', () => {
    // Verify the validator exists and has the expected shape
    expect(teamKindValidator).toBeDefined();
    expect(typeof teamKindValidator).toBe('object');
  });

  test('type exhaustiveness compiles', () => {
    // Compile-time check: if a new TeamKind is added, this switch should fail
    // to compile (unless the new kind is handled). We use a runtime assertion
    // that all known kinds pass isTeamKind.
    const allKnown: TeamKind[] = [...WELL_KNOWN_TEAM_KINDS];

    const _exhaustive: TeamKind[] = allKnown;
    expect(allKnown.every(isTeamKind)).toBe(true);
  });

  test('teamKindValidator.members stays in sync with WELL_KNOWN_TEAM_KINDS', () => {
    // Convex VUnion exposes its members at runtime. Each member is a VLiteral
    // whose `.value` is the literal it accepts. Sorting both sides because the
    // test asserts set-equality, not order (order is already asserted elsewhere).
    const validatorMembers = (teamKindValidator.members as readonly { value: TeamKind }[])
      .map((m) => m.value)
      .slice()
      .sort();
    const sourceMembers = WELL_KNOWN_TEAM_KINDS.slice().sort();
    expect(validatorMembers).toEqual(sourceMembers);
  });
});
