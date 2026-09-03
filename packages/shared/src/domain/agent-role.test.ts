import { describe, expect, test } from 'vitest';

import {
  getAgentRoleTags,
  getPermanentRoleNames,
  hasAgentRoleTag,
  isEphemeralAgentRole,
  isPermanentAgentRole,
} from './agent-role';

describe('agent-role lifecycle tags', () => {
  test('known roles carry exactly one lifecycle tag', () => {
    expect(getAgentRoleTags('planner')).toEqual(['permanent']);
    expect(getAgentRoleTags('builder')).toEqual(['ephemeral']);
    expect(getAgentRoleTags('solo')).toEqual(['permanent']);
    expect(getAgentRoleTags('enhancer')).toEqual(['ephemeral']);
  });

  test('unknown roles default to permanent', () => {
    expect(getAgentRoleTags('architect')).toEqual(['permanent']);
    expect(getAgentRoleTags(' custom-role ')).toEqual(['permanent']);
    expect(hasAgentRoleTag('architect', 'permanent')).toBe(true);
    expect(hasAgentRoleTag('architect', 'ephemeral')).toBe(false);
  });

  test('tag helpers are case-insensitive', () => {
    expect(isEphemeralAgentRole('Enhancer')).toBe(true);
    expect(isPermanentAgentRole('PLANNER')).toBe(true);
  });

  test('filters ephemeral roles from a team role list', () => {
    expect(getPermanentRoleNames(['planner', 'enhancer', 'builder'])).toEqual(['planner']);
    expect(getPermanentRoleNames(['solo', 'enhancer'])).toEqual(['solo']);
    expect(getPermanentRoleNames(['architect'])).toEqual(['architect']);
  });
});
