/**
 * Unit tests for Team entity helpers
 */

import { describe, expect, test } from 'vitest';

import { getTeamEntryPoint, isEntryPoint, toTeam } from '../../../../src/domain/entities/team';

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
    const result = getTeamEntryPoint({
      teamEntryPoint: 'builder',
      teamRoles: ['planner', 'builder'],
    });
    expect(result).toBe('builder');
    expect(result).not.toBe('planner');
  });
});

describe('toTeam', () => {
  test('creates a Team with explicit entry point', () => {
    const team = toTeam({
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    expect(team).toEqual({
      id: 'duo',
      name: 'Duo Team',
      roles: ['planner', 'builder'],
      entryPoint: 'planner',
    });
  });

  test('falls back to first role when no teamEntryPoint', () => {
    const team = toTeam({
      teamId: 'pair',
      teamRoles: ['builder', 'reviewer'],
    });
    expect(team).toEqual({
      id: 'pair',
      name: 'pair', // falls back to id when no name
      roles: ['builder', 'reviewer'],
      entryPoint: 'builder',
    });
  });

  test('uses teamId as name fallback when teamName is missing', () => {
    const team = toTeam({ teamId: 'squad', teamRoles: ['planner', 'builder', 'reviewer'] });
    expect(team?.name).toBe('squad');
  });

  test('returns null when teamId is missing', () => {
    expect(toTeam({ teamRoles: ['builder', 'reviewer'] })).toBeNull();
  });

  test('returns null when teamRoles is missing', () => {
    expect(toTeam({ teamId: 'duo' })).toBeNull();
  });

  test('returns null when teamRoles is empty', () => {
    expect(toTeam({ teamId: 'duo', teamRoles: [] })).toBeNull();
  });

  test('returns null for empty chatroom', () => {
    expect(toTeam({})).toBeNull();
  });
});

describe('isEntryPoint', () => {
  const duoTeam = toTeam({
    teamId: 'duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  })!;

  test('returns true for the entry point role', () => {
    expect(isEntryPoint(duoTeam, 'planner')).toBe(true);
  });

  test('returns false for non-entry point role', () => {
    expect(isEntryPoint(duoTeam, 'builder')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(isEntryPoint(duoTeam, 'PLANNER')).toBe(true);
    expect(isEntryPoint(duoTeam, 'Planner')).toBe(true);
  });
});
