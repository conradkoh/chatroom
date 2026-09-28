import { describe, expect, test } from 'vitest';

import {
  AgentRoleLifecycleTag,
  AGENT_ROLE_DEFINITIONS,
  getAgentRoleTags,
  getPermanentRoleNames,
  hasAgentRoleTag,
  isRetiredAgentRole,
  isEphemeralAgentRole,
  isPermanentAgentRole,
} from './agent-role';

describe('agent-role lifecycle tags', () => {
  test('known roles carry exactly one lifecycle tag', () => {
    expect(getAgentRoleTags('planner')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('builder')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('solo')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('architect')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect(getAgentRoleTags('uiux-engineer')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect('enhancer' in AGENT_ROLE_DEFINITIONS).toBe(false);
    expect(getAgentRoleTags('enhancer')).toEqual([AgentRoleLifecycleTag.Permanent]);
  });

  test('unknown roles default to permanent', () => {
    expect(getAgentRoleTags('custom-role')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags(' custom-role ')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Permanent)).toBe(true);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Ephemeral)).toBe(false);
  });

  test('tag helpers are case-insensitive', () => {
    expect(isEphemeralAgentRole('Architect')).toBe(true);
    expect(isEphemeralAgentRole('UIUX-ENGINEER')).toBe(true);
    expect(isPermanentAgentRole('PLANNER')).toBe(true);
    expect(isRetiredAgentRole('Enhancer')).toBe(true);
    expect(isRetiredAgentRole('ENHANCER')).toBe(true);
    expect(isRetiredAgentRole('architect')).toBe(false);
  });

  test('filters ephemeral roles from a team role list', () => {
    expect(
      getPermanentRoleNames(['planner', 'architect', 'uiux-engineer', 'builder', 'enhancer'])
    ).toEqual(['planner', 'builder']);
    expect(getPermanentRoleNames(['solo', 'architect', 'uiux-engineer', 'enhancer'])).toEqual([
      'solo',
    ]);
    expect(getPermanentRoleNames(['architect'])).toEqual([]);
    expect(getPermanentRoleNames(['uiux-engineer'])).toEqual([]);
  });
});
