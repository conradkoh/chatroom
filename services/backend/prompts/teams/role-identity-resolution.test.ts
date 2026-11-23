import { TEAM_PRESETS } from '@workspace/shared/domain/team-presets';
import { describe, expect, test } from 'vitest';

import type { RoleIdentity } from '../types/role-identity';
import { CUSTOM_TEAM_ROLE_IDENTITY } from './custom/prompts/role-identity';
import { resolveRoleIdentity, TEAM_PROMPT_MODULES } from './registry';

const PRESET_IDS = ['duo', 'solo', 'trio'] as const;

const CATALOGUES: Readonly<Record<string, Readonly<Record<string, RoleIdentity>>>> = {
  duo: TEAM_PROMPT_MODULES.duo.roleIdentity,
  solo: TEAM_PROMPT_MODULES.solo.roleIdentity,
  trio: TEAM_PROMPT_MODULES.trio.roleIdentity,
  custom: CUSTOM_TEAM_ROLE_IDENTITY,
};

describe('per-team role identity catalogues', () => {
  test.each(PRESET_IDS)('%s catalogue keys equal preset membership', (teamId) => {
    expect(Object.keys(TEAM_PROMPT_MODULES[teamId].roleIdentity).sort()).toEqual(
      [...TEAM_PRESETS[teamId].roles].sort()
    );
  });

  test.each(PRESET_IDS)('%s member roles resolve to the team-owned identity', (teamId) => {
    const catalogue = TEAM_PROMPT_MODULES[teamId].roleIdentity as Readonly<
      Record<string, RoleIdentity>
    >;
    for (const role of TEAM_PRESETS[teamId].roles) {
      expect(resolveRoleIdentity({ team: teamId, role })).toBe(catalogue[role]);
    }
  });

  test('no two catalogues share an identity object', () => {
    const names = Object.keys(CATALOGUES);
    let sharedKeyCount = 0;

    for (let left = 0; left < names.length; left += 1) {
      for (let right = left + 1; right < names.length; right += 1) {
        const a = CATALOGUES[names[left]];
        const b = CATALOGUES[names[right]];
        for (const role of Object.keys(a)) {
          if (!Object.prototype.hasOwnProperty.call(b, role)) continue;
          sharedKeyCount += 1;
          expect(a[role], `${names[left]} and ${names[right]} share "${role}"`).not.toBe(b[role]);
        }
      }
    }

    expect(sharedKeyCount).toBeGreaterThan(0);
  });

  test('roles outside a preset catalogue fall back to the legacy catalogue', () => {
    expect(resolveRoleIdentity({ team: 'solo', role: 'builder' })).toBe(
      CUSTOM_TEAM_ROLE_IDENTITY.builder
    );
    expect(resolveRoleIdentity({ team: 'unknown', role: 'architect' })).toBe(
      CUSTOM_TEAM_ROLE_IDENTITY.architect
    );
  });

  test('literal titles and descriptions keep their text', () => {
    expect(resolveRoleIdentity({ team: 'trio', role: 'architect' }).description).toBe(
      'You are the architect responsible for producing one complete implementation design for the request; you are not an implementer.'
    );
    expect(resolveRoleIdentity({ team: 'trio', role: 'uiux-engineer' }).title).toBe(
      'UI/UX Engineer'
    );
    expect(resolveRoleIdentity({ team: 'trio', role: 'triage' }).title).toBe('Triage Agent');
    expect(resolveRoleIdentity({ team: 'unknown', role: 'game-asset-designer' }).title).toBe(
      'Game Asset Designer'
    );
  });

  test('roles absent from every catalogue resolve through the shared fallback chain', () => {
    const tester = {
      title: 'Tester',
      description: 'You are the QA role responsible for testing and validation.',
    };
    expect(resolveRoleIdentity({ team: 'unknown', role: 'tester' })).toEqual(tester);
    expect(resolveRoleIdentity({ team: 'duo', role: 'tester' })).toEqual(tester);

    expect(resolveRoleIdentity({ team: 'unknown', role: 'designer' })).toEqual({
      title: 'Designer',
      description: 'You are participating as the designer in this collaborative workflow.',
    });
    expect(resolveRoleIdentity({ team: 'unknown', role: 'Designer' })).toEqual({
      title: 'Designer',
      description: 'You are participating as the Designer in this collaborative workflow.',
    });

    const ephemeral = resolveRoleIdentity({ team: 'unknown', role: 'enhancer' });
    expect(ephemeral.title).toBe('Ephemeral Agent');
    expect(ephemeral.description).toBe(
      'You are an ephemeral team agent. Complete the assigned task using the configured team workflow, then hand off when the task is complete.'
    );
    expect(ephemeral.description).not.toMatch(/enhancer/i);
  });

  test('role lookup is case-insensitive', () => {
    expect(resolveRoleIdentity({ team: 'trio', role: 'Architect' })).toBe(
      TEAM_PROMPT_MODULES.trio.roleIdentity.architect
    );
  });

  test('prototype keys are not roles', () => {
    const identity = resolveRoleIdentity({ team: 'unknown', role: 'constructor' });
    expect(identity.title).toBe('Constructor');
    expect(identity.description).toBe(
      'You are participating as the constructor in this collaborative workflow.'
    );
  });
});
