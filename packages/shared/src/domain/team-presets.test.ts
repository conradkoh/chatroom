import { describe, expect, test } from 'vitest';

import {
  AgentRoleLifecycleTag,
  AGENT_ROLE_DEFINITIONS,
  getAgentRoleTags,
  getBuiltinRolesForTeam,
} from './agent-role';
import { TEAM_PRESET_IDS } from './team-kind';
import {
  DEFAULT_TEAM_PRESET_ID,
  TEAM_PRESET_IDS as PRESET_IDS,
  TEAM_STRUCTURE_IDS,
  TEAM_PRESETS,
  getTeamStructure,
  getPermanentRolesForPreset,
  getTeamPreset,
  getTeamStructureId,
  listTeamPresetIds,
} from './team-presets';

describe('team presets', () => {
  test('canonical duo and solo shapes include optional ephemeral support roles', () => {
    expect(TEAM_PRESETS.duo).toMatchObject({
      name: 'Duo',
      structureId: 'duo@1',
      description:
        'A planner and builder working as a pair, planner as coordinator, with optional ephemeral architect, researcher, triage, and uiux-engineer roles',
      roles: ['planner', 'architect', 'researcher', 'triage', 'uiux-engineer', 'builder'],
      entryPoint: 'planner',
    });
    expect(TEAM_PRESETS.solo).toMatchObject({
      name: 'Solo',
      structureId: 'solo@1',
      description:
        'A single agent working independently, with optional ephemeral architect, triage, and uiux-engineer roles',
      roles: ['solo', 'architect', 'triage', 'uiux-engineer'],
      entryPoint: 'solo',
    });
    expect(DEFAULT_TEAM_PRESET_ID).toBe('duo');
    expect(PRESET_IDS).toBe(TEAM_PRESET_IDS);
    expect(TEAM_STRUCTURE_IDS).toEqual({ duo: 'duo@1', solo: 'solo@1' });
  });

  test.each(TEAM_PRESET_IDS)(
    '%s structure derives from unique ordered metadata membership',
    (teamId) => {
      const preset = TEAM_PRESETS[teamId];
      const orderedMemberships = Object.values(AGENT_ROLE_DEFINITIONS)
        .flatMap((definition) =>
          definition.teams
            .filter((membership) => membership.teamId === teamId)
            .map(({ order }) => ({ role: definition.role, order }))
        )
        .sort((left, right) => left.order - right.order);
      expect(preset.roles).toEqual(orderedMemberships.map(({ role }) => role));
      expect(preset.roles).toEqual(getBuiltinRolesForTeam(teamId));
      expect(new Set(preset.roles).size).toBe(preset.roles.length);
      expect(new Set(orderedMemberships.map(({ order }) => order)).size).toBe(
        orderedMemberships.length
      );
      expect(preset.roles).toContain(preset.entryPoint);
      expect(getAgentRoleTags(preset.entryPoint)).toEqual([AgentRoleLifecycleTag.Permanent]);
      expect(getTeamStructure({ teamId }).roles).toEqual(
        teamId === 'duo'
          ? [
              { role: 'planner', lifecycle: 'permanent', optional: false },
              { role: 'architect', lifecycle: 'ephemeral', optional: true },
              { role: 'researcher', lifecycle: 'ephemeral', optional: true },
              { role: 'triage', lifecycle: 'ephemeral', optional: true },
              { role: 'uiux-engineer', lifecycle: 'ephemeral', optional: true },
              { role: 'builder', lifecycle: 'permanent', optional: false },
            ]
          : [
              { role: 'solo', lifecycle: 'permanent', optional: false },
              { role: 'architect', lifecycle: 'ephemeral', optional: true },
              { role: 'triage', lifecycle: 'ephemeral', optional: true },
              { role: 'uiux-engineer', lifecycle: 'ephemeral', optional: true },
            ]
      );
    }
  );

  test('lists and resolves known preset IDs', () => {
    expect(listTeamPresetIds()).toEqual(['duo', 'solo']);
    expect(getTeamPreset('duo')).toBe(TEAM_PRESETS.duo);
    expect(getTeamPreset('duo@1')).toBe(TEAM_PRESETS.duo);
    expect(getTeamPreset('solo')).toBe(TEAM_PRESETS.solo);
    expect(getTeamPreset('solo@1')).toBe(TEAM_PRESETS.solo);
    expect(getTeamStructureId('duo')).toBe('duo@1');
    expect(getTeamStructureId('solo')).toBe('solo@1');
    expect(getTeamPreset('unknown')).toBeUndefined();
  });

  test('permanent roles include only the permanent entry-point roles', () => {
    expect(getPermanentRolesForPreset('duo')).toEqual(['planner', 'builder']);
    expect(getPermanentRolesForPreset('solo')).toEqual(['solo']);
  });

  test('unknown teams retain caller-provided role strings and entry point', () => {
    expect(
      getTeamStructure({
        teamId: ' custom-team ',
        teamName: 'Custom Team',
        persistedRoles: ['reviewer', 'enhancer'],
        persistedEntryPoint: 'reviewer',
      })
    ).toEqual({
      teamId: ' custom-team ',
      teamStructureId: 'custom-team',
      teamName: 'Custom Team',
      entryPoint: 'reviewer',
      roles: [
        { role: 'reviewer', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
        { role: 'enhancer', lifecycle: AgentRoleLifecycleTag.Permanent, optional: false },
      ],
    });
  });

  test('repeated canonical reads are deterministic and return fresh role objects', () => {
    const first = getTeamStructure({ teamId: 'duo', persistedRoles: ['planner', 'builder'] });
    const second = getTeamStructure({ teamId: 'duo', persistedRoles: ['planner', 'builder'] });
    expect(second).toEqual(first);
    expect(second.roles).not.toBe(first.roles);
    expect(second.roles[0]).not.toBe(first.roles[0]);
  });

  test.each([
    [
      'duo',
      'duo@1',
      'Duo',
      'planner',
      ['planner', 'architect', 'researcher', 'triage', 'uiux-engineer', 'builder'],
    ],
    [
      'duo@1',
      'duo@1',
      'Duo',
      'planner',
      ['planner', 'architect', 'researcher', 'triage', 'uiux-engineer', 'builder'],
    ],
    ['solo', 'solo@1', 'Solo', 'solo', ['solo', 'architect', 'triage', 'uiux-engineer']],
    ['solo@1', 'solo@1', 'Solo', 'solo', ['solo', 'architect', 'triage', 'uiux-engineer']],
  ] as const)(
    'resolves %s from persisted roles that omit triage',
    (teamId, teamStructureId, teamName, entryPoint, roles) => {
      const structure = getTeamStructure({
        teamId,
        persistedRoles: teamName === 'Duo' ? ['planner', 'builder'] : ['solo'],
      });
      expect(structure).toMatchObject({
        teamId: teamStructureId.split('@')[0],
        teamStructureId,
        teamName,
        entryPoint,
        roles: roles.map((role) => ({
          role,
          lifecycle: ['architect', 'researcher', 'triage', 'uiux-engineer'].includes(role)
            ? 'ephemeral'
            : 'permanent',
          optional: ['architect', 'researcher', 'triage', 'uiux-engineer'].includes(role),
        })),
      });
      expect(structure.roles.find(({ role }) => role === 'triage')).toEqual({
        role: 'triage',
        lifecycle: 'ephemeral',
        optional: true,
      });
      expect(
        getTeamStructure({ teamId: 'duo' }).roles.some(({ role }) => role === 'enhancer')
      ).toBe(false);
    }
  );
});
