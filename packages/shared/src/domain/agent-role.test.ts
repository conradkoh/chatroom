import { describe, expect, test } from 'vitest';

import {
  AgentRoleLifecycleTag,
  getAgentRoleTags,
  getPermanentRoleNames,
  hasAgentRoleTag,
  isEphemeralAgentRole,
  isPermanentAgentRole,
} from './agent-role';

describe('agent-role lifecycle tags', () => {
  test('known roles carry exactly one lifecycle tag', () => {
    expect(getAgentRoleTags('planner')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('builder')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('solo')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('architect')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('uiux-engineer')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('enhancer')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
  });

  test('unknown roles default to permanent', () => {
    expect(getAgentRoleTags('custom-role')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags(' custom-role ')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Permanent)).toBe(true);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Ephemeral)).toBe(false);
  });

  test('tag helpers are case-insensitive', () => {
    expect(isEphemeralAgentRole('Enhancer')).toBe(true);
    expect(isPermanentAgentRole('PLANNER')).toBe(true);
  });

  test('filters ephemeral roles from a team role list', () => {
    expect(getPermanentRoleNames(['planner', 'enhancer', 'builder'])).toEqual([
      'planner',
      'builder',
    ]);
    expect(getPermanentRoleNames(['solo', 'enhancer'])).toEqual(['solo']);
    expect(getPermanentRoleNames(['architect'])).toEqual(['architect']);
    expect(getPermanentRoleNames(['uiux-engineer'])).toEqual(['uiux-engineer']);
  });
});
