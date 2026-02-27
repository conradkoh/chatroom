/**
 * Unit tests for getTeamEntryPoint
 */

import { describe, expect, test } from 'vitest';

import { getTeamEntryPoint } from '../../../../src/domain/entities/team';

describe('getTeamEntryPoint', () => {
  test('returns teamEntryPoint when explicitly set', () => {
    expect(
      getTeamEntryPoint({ teamEntryPoint: 'planner', teamRoles: ['planner', 'builder'] })
    ).toBe('planner');
  });

  test('returns non-first role when teamEntryPoint points to it', () => {
    expect(
      getTeamEntryPoint({ teamEntryPoint: 'builder', teamRoles: ['planner', 'builder'] })
    ).toBe('builder');
  });

  test('falls back to first teamRole when no teamEntryPoint', () => {
    expect(getTeamEntryPoint({ teamRoles: ['builder', 'reviewer'] })).toBe('builder');
  });

  test('falls back to first teamRole when teamEntryPoint is null', () => {
    expect(getTeamEntryPoint({ teamEntryPoint: null, teamRoles: ['planner', 'builder'] })).toBe(
      'planner'
    );
  });

  test('returns null when teamRoles is empty', () => {
    expect(getTeamEntryPoint({ teamRoles: [] })).toBeNull();
  });

  test('returns null when both teamEntryPoint and teamRoles are absent', () => {
    expect(getTeamEntryPoint({})).toBeNull();
  });

  test('returns null when teamRoles is null', () => {
    expect(getTeamEntryPoint({ teamRoles: null })).toBeNull();
  });

  test('teamEntryPoint takes priority over first teamRole', () => {
    // planner is first role, but entryPoint is builder
    const result = getTeamEntryPoint({
      teamEntryPoint: 'builder',
      teamRoles: ['planner', 'builder'],
    });
    expect(result).toBe('builder');
    expect(result).not.toBe('planner');
  });
});
