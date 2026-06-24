/**
 * TEAMS_CONFIG sync test
 *
 * Ensures the frontend team configuration stays in sync with the backend's
 * canonical team kind list.
 */

import { WELL_KNOWN_TEAM_KINDS } from '@workspace/backend/src/domain/entities/team-kind';
import { describe, expect, test } from 'vitest';

import { TEAMS_CONFIG } from './teams';

describe('TEAMS_CONFIG sync with backend', () => {
  test('UI teams match backend well-known kinds', () => {
    const uiKinds = Object.keys(TEAMS_CONFIG.teams).sort();
    const expectedKinds = [...WELL_KNOWN_TEAM_KINDS].sort();

    expect(uiKinds).toEqual(expectedKinds);
  });

  test('defaultTeam is a key in teams', () => {
    expect(Object.keys(TEAMS_CONFIG.teams)).toContain(TEAMS_CONFIG.defaultTeam);
  });

  test('no extra UI kinds that backend does not know about', () => {
    const uiKinds = Object.keys(TEAMS_CONFIG.teams);
    const knownKinds = new Set<string>(WELL_KNOWN_TEAM_KINDS);
    for (const kind of uiKinds) {
      expect(knownKinds.has(kind)).toBe(true);
    }
  });
});
