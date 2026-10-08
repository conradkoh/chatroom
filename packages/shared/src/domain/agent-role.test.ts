import { describe, expect, test } from 'vitest';

import {
  AgentRoleLifecycleTag,
  AGENT_ROLE_DEFINITIONS,
  type AgentRoleDefinition,
  getAgentRoleTags,
  isBuiltinAgentRole,
  getPermanentRoleNames,
  hasAgentRoleTag,
  isRetiredAgentRole,
  isEphemeralAgentRole,
  isPermanentAgentRole,
  validateAgentRoleDefinitions,
} from './agent-role';

describe('agent-role lifecycle tags', () => {
  test('known roles carry exactly one lifecycle tag', () => {
    expect(getAgentRoleTags('planner')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('builder')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('solo')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags('architect')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect(getAgentRoleTags('triage')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect(getAgentRoleTags('uiux-engineer')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect(getAgentRoleTags('researcher')).toEqual([AgentRoleLifecycleTag.Ephemeral]);
    expect('enhancer' in AGENT_ROLE_DEFINITIONS).toBe(false);
    expect(getAgentRoleTags('enhancer')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(isBuiltinAgentRole('triage')).toBe(true);
    expect(isBuiltinAgentRole('Triage')).toBe(false);
    expect(isBuiltinAgentRole(' triage ')).toBe(false);
    expect(isBuiltinAgentRole('user')).toBe(false);
    expect(isBuiltinAgentRole('enhancer')).toBe(false);
  });

  test('unknown roles default to permanent', () => {
    expect(getAgentRoleTags('custom-role')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(getAgentRoleTags(' custom-role ')).toEqual([AgentRoleLifecycleTag.Permanent]);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Permanent)).toBe(true);
    expect(hasAgentRoleTag('custom-role', AgentRoleLifecycleTag.Ephemeral)).toBe(false);
  });

  test('tag helpers are case-insensitive', () => {
    expect(isEphemeralAgentRole('Architect')).toBe(true);
    expect(isEphemeralAgentRole('triage')).toBe(true);
    expect(isEphemeralAgentRole('UIUX-ENGINEER')).toBe(true);
    expect(isEphemeralAgentRole('Researcher')).toBe(true);
    expect(isPermanentAgentRole('PLANNER')).toBe(true);
    expect(isRetiredAgentRole('Enhancer')).toBe(true);
    expect(isRetiredAgentRole('ENHANCER')).toBe(true);
    expect(isRetiredAgentRole('architect')).toBe(false);
  });

  test('filters ephemeral roles from a team role list', () => {
    expect(
      getPermanentRoleNames([
        'planner',
        'architect',
        'triage',
        'uiux-engineer',
        'builder',
        'enhancer',
      ])
    ).toEqual(['planner', 'builder']);
    expect(
      getPermanentRoleNames(['solo', 'architect', 'triage', 'uiux-engineer', 'enhancer'])
    ).toEqual(['solo']);
    expect(getPermanentRoleNames(['researcher'])).toEqual([]);
    expect(getPermanentRoleNames(['architect'])).toEqual([]);
    expect(getPermanentRoleNames(['triage'])).toEqual([]);
    expect(getPermanentRoleNames(['uiux-engineer'])).toEqual([]);
  });

  test('authored definitions have one lifecycle and nonempty unique valid team memberships', () => {
    const definitions = Object.values(AGENT_ROLE_DEFINITIONS);
    expect(() => validateAgentRoleDefinitions(definitions)).not.toThrow();
    expect(
      Object.entries(AGENT_ROLE_DEFINITIONS).every(([key, definition]) => key === definition.role)
    ).toBe(true);
    expect(new Set(definitions.map(({ role }) => role)).size).toBe(definitions.length);
    for (const definition of definitions) {
      expect(definition.tags).toHaveLength(1);
      expect(definition.teams.length).toBeGreaterThan(0);
      expect(new Set(definition.teams.map(({ teamId }) => teamId)).size).toBe(
        definition.teams.length
      );
      for (const membership of definition.teams) {
        expect(Number.isSafeInteger(membership.order)).toBe(true);
        expect(membership.order).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('rejects a definition without team membership', () => {
    const malformed = [{ role: 'reviewer', tags: [AgentRoleLifecycleTag.Permanent] }];
    expect(() =>
      validateAgentRoleDefinitions(malformed as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "reviewer" must declare at least one team membership');
  });

  test('rejects an empty team membership list and unknown team IDs', () => {
    const emptyMembership = [
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [],
      },
    ];
    expect(() =>
      validateAgentRoleDefinitions(emptyMembership as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "reviewer" must declare at least one team membership');

    const unknownTeam = [
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [{ teamId: 'other', order: 10 }],
      },
    ];
    expect(() =>
      validateAgentRoleDefinitions(unknownTeam as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "reviewer" has unknown team "other"');
  });

  test('rejects duplicate membership of one role in the same team', () => {
    const malformed = [
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [
          { teamId: 'duo', order: 10 },
          { teamId: 'duo', order: 20 },
        ],
      },
    ];
    expect(() =>
      validateAgentRoleDefinitions(malformed as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "reviewer" has duplicate membership in team "duo"');
  });

  test('rejects colliding order values between distinct roles in one team', () => {
    const malformed = [
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [{ teamId: 'duo', order: 10 }],
      },
      {
        role: 'tester',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [{ teamId: 'duo', order: 10 }],
      },
    ];
    expect(() =>
      validateAgentRoleDefinitions(malformed as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "tester" order 10 for team "duo" conflicts with role "reviewer"');
  });

  test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid membership order %s',
    (order) => {
      const malformed = [
        {
          role: 'reviewer',
          tags: [AgentRoleLifecycleTag.Permanent],
          teams: [{ teamId: 'duo', order }],
        },
      ];
      expect(() =>
        validateAgentRoleDefinitions(malformed as unknown as readonly AgentRoleDefinition[])
      ).toThrow(`Agent role "reviewer" has invalid order "${String(order)}" for team "duo"`);
    }
  );

  test.each([
    {
      label: 'multiple lifecycle tags',
      definitions: [
        {
          role: 'reviewer',
          tags: [AgentRoleLifecycleTag.Permanent, AgentRoleLifecycleTag.Ephemeral],
          teams: [{ teamId: 'duo', order: 10 }],
        },
      ],
      expectedError: 'Agent role "reviewer" must declare exactly one recognized lifecycle tag',
    },
    {
      label: 'noncanonical names',
      definitions: [
        {
          role: 'Reviewer',
          tags: [AgentRoleLifecycleTag.Permanent],
          teams: [{ teamId: 'duo', order: 10 }],
        },
      ],
      expectedError: 'Agent role "Reviewer" must have a normalized nonempty name',
    },
    {
      label: 'retired roles',
      definitions: [
        {
          role: 'enhancer',
          tags: [AgentRoleLifecycleTag.Permanent],
          teams: [{ teamId: 'duo', order: 10 }],
        },
      ],
      expectedError: 'Agent role "enhancer" is reserved or retired',
    },
    {
      label: 'reserved user role',
      definitions: [
        {
          role: 'user',
          tags: [AgentRoleLifecycleTag.Permanent],
          teams: [{ teamId: 'duo', order: 10 }],
        },
      ],
      expectedError: 'Agent role "user" is reserved or retired',
    },
  ])('rejects $label definitions', ({ definitions, expectedError }) => {
    expect(() =>
      validateAgentRoleDefinitions(definitions as unknown as readonly AgentRoleDefinition[])
    ).toThrow(expectedError);
  });

  test('rejects duplicate normalized names', () => {
    const malformed = [
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [{ teamId: 'duo', order: 10 }],
      },
      {
        role: 'reviewer',
        tags: [AgentRoleLifecycleTag.Permanent],
        teams: [{ teamId: 'solo', order: 10 }],
      },
    ];
    expect(() =>
      validateAgentRoleDefinitions(malformed as unknown as readonly AgentRoleDefinition[])
    ).toThrow('Agent role "reviewer" duplicates normalized role "reviewer"');
  });
});
