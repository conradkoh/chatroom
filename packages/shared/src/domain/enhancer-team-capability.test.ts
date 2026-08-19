import { describe, expect, test } from 'vitest';

import {
  getEnhancerEntryPointRole,
  isEnhancerEntryPointRole,
  teamSupportsEnhancer,
} from './enhancer-team-capability';

describe('enhancer team capability', () => {
  test.each([
    [{ teamId: 'duo', teamRoles: ['planner', 'builder'], teamEntryPoint: 'planner' }, 'planner'],
    [{ teamId: 'solo', teamRoles: ['solo'], teamEntryPoint: 'solo' }, 'solo'],
  ])('returns the configured entry point for a supported team', (team, expected) => {
    expect(teamSupportsEnhancer(team)).toBe(true);
    expect(getEnhancerEntryPointRole(team)).toBe(expected);
    expect(isEnhancerEntryPointRole(team, expected)).toBe(true);
  });

  test('does not infer enhancer support for an unknown team', () => {
    const team = { teamId: 'squad', teamRoles: ['lead'], teamEntryPoint: 'lead' };
    expect(teamSupportsEnhancer(team)).toBe(false);
    expect(getEnhancerEntryPointRole(team)).toBeNull();
    expect(isEnhancerEntryPointRole(team, 'lead')).toBe(false);
  });

  test('rejects a supported team whose configured entry point violates its workflow contract', () => {
    const team = { teamId: 'duo', teamRoles: ['planner', 'builder'], teamEntryPoint: 'builder' };
    expect(teamSupportsEnhancer(team)).toBe(true);
    expect(isEnhancerEntryPointRole(team, 'planner')).toBe(false);
    expect(isEnhancerEntryPointRole(team, 'builder')).toBe(false);
  });

  test('requires the supported role to be present in the selected team', () => {
    expect(teamSupportsEnhancer({ teamId: 'solo', teamRoles: ['builder'] })).toBe(false);
  });
});
