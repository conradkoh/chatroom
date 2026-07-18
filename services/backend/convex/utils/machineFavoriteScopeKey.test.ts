import { describe, expect, test } from 'vitest';

import {
  buildMachineFavoriteScopeKey,
  isLegacyMachineFavoriteScopeKey,
  normalizeMachineFavoriteScopeKey,
} from './machineFavoriteScopeKey';

describe('machineFavoriteScopeKey', () => {
  test('buildMachineFavoriteScopeKey lowercases team and role', () => {
    expect(buildMachineFavoriteScopeKey('Duo', 'Planner')).toBe('team_duo#role_planner');
  });

  test('normalizeMachineFavoriteScopeKey returns new-format key unchanged', () => {
    expect(normalizeMachineFavoriteScopeKey('team_duo#role_planner')).toBe('team_duo#role_planner');
  });

  test('normalizeMachineFavoriteScopeKey strips chatroom prefix from legacy key', () => {
    expect(normalizeMachineFavoriteScopeKey('chatroom_room1#team_duo#role_planner')).toBe(
      'team_duo#role_planner'
    );
  });

  test('isLegacyMachineFavoriteScopeKey returns true for chatroom-prefixed key', () => {
    expect(isLegacyMachineFavoriteScopeKey('chatroom_room1#team_duo#role_planner')).toBe(true);
  });

  test('isLegacyMachineFavoriteScopeKey returns false for new-format key', () => {
    expect(isLegacyMachineFavoriteScopeKey('team_duo#role_planner')).toBe(false);
  });
});
