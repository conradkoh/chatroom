import { describe, expect, test } from 'vitest';
import { buildTeamRoleKey, buildMachineConfigScopeKey } from './teamRoleKey';

describe('teamRoleKey', () => {
  test('buildTeamRoleKey lowercases team and role', () => {
    expect(buildTeamRoleKey('room1', 'Duo', 'Planner')).toBe(
      'chatroom_room1#team_duo#role_planner'
    );
  });

  test('buildMachineConfigScopeKey combines machine and teamRole', () => {
    expect(buildMachineConfigScopeKey('m1', 'room1', 'duo', 'planner')).toBe(
      'm1|chatroom_room1#team_duo#role_planner'
    );
  });
});
