import { describe, expect, test } from 'vitest';

import {
  buildTeamRoleKey,
  buildMachineConfigScopeKey,
  buildMachineFavoriteScopeKey,
} from './teamRoleKey';

describe('teamRoleKey', () => {
  test('buildTeamRoleKey lowercases team and role', () => {
    expect(buildTeamRoleKey('room1', 'Duo', 'Planner')).toBe(
      'chatroom_room1#team_duo#role_planner'
    );
  });

  test('buildMachineFavoriteScopeKey lowercases team and role', () => {
    expect(buildMachineFavoriteScopeKey('Duo', 'Planner')).toBe('team_duo#role_planner');
  });

  test('buildMachineConfigScopeKey is machine-scoped without chatroom', () => {
    expect(buildMachineConfigScopeKey('m1', 'duo', 'planner')).toBe('m1|team_duo#role_planner');
  });
});
