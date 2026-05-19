/**
 * TEAMS_CONFIG sync test
 *
 * Ensures the frontend team configuration stays in sync with the backend's
 * canonical team kind list. When a new team kind is added to the backend
 * WELL_KNOWN_TEAM_KINDS, this test will fail until the frontend
 * TEAMS_CONFIG is updated (or the new kind is added to DEPRECATED_TEAM_KINDS
 * if it should be hidden from the UI intentionally).
 */

import { describe, expect, test } from 'vitest';

import { WELL_KNOWN_TEAM_KINDS } from '@workspace/backend/src/domain/entities/team-kind';
import { TEAMS_CONFIG } from './teams';

/**
 * Team kinds that exist in the backend but are intentionally hidden from
 * the UI (e.g. deprecated team types that still have database records).
 */
const DEPRECATED_TEAM_KINDS: readonly string[] = ['pair'];

describe('TEAMS_CONFIG sync with backend', () => {
  test('every backend kind is either in UI config or deprecated', () => {
    const uiKinds = Object.keys(TEAMS_CONFIG.teams).sort();
    const expectedKinds = WELL_KNOWN_TEAM_KINDS.filter(
      (k) => !DEPRECATED_TEAM_KINDS.includes(k)
    ).sort();

    expect(uiKinds).toEqual(expectedKinds);
  });

  test('defaultTeam is a key in teams', () => {
    expect(Object.keys(TEAMS_CONFIG.teams)).toContain(TEAMS_CONFIG.defaultTeam);
  });

  test('no extra UI kinds that backend does not know about', () => {
    const uiKinds = Object.keys(TEAMS_CONFIG.teams);
    const knownKinds = new Set([...WELL_KNOWN_TEAM_KINDS, ...DEPRECATED_TEAM_KINDS]);
    for (const kind of uiKinds) {
      expect(knownKinds.has(kind)).toBe(true);
    }
  });
});
