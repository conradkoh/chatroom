import { describe, expect, test } from 'vitest';

import { buildMachineConfigScopeKey, buildMachineFavoriteScopeKey } from './machineConfigScopeKey';

describe('machineConfigScopeKey', () => {
  test('buildMachineFavoriteScopeKey lowercases team and role', () => {
    expect(buildMachineFavoriteScopeKey('Duo', 'Planner')).toBe('team_duo#role_planner');
  });

  test('buildMachineConfigScopeKey is machine-scoped without chatroom', () => {
    expect(buildMachineConfigScopeKey('m1', 'duo', 'planner')).toBe('m1|team_duo#role_planner');
  });
});
