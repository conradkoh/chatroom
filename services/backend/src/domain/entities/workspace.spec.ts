/**
 * Unit tests for Workspace entity helpers
 */

import { describe, expect, test } from 'vitest';

import {
  canRegisterWorkspace,
  isActiveWorkspace,
  MAX_ACTIVE_WORKSPACES_PER_CHATROOM,
} from './workspace';

describe('isActiveWorkspace', () => {
  test('returns true when removedAt is undefined', () => {
    expect(isActiveWorkspace(undefined)).toBe(true);
  });

  test('returns false when removedAt is set to a timestamp', () => {
    expect(isActiveWorkspace(1700000000000)).toBe(false);
  });

  test('returns false when removedAt is 0', () => {
    expect(isActiveWorkspace(0)).toBe(false);
  });
});

describe('canRegisterWorkspace', () => {
  test('allows the first active workspace', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [],
        target: { machineId: 'm1', workingDir: '/a' },
      })
    ).toBe(true);
  });

  test('allows re-registering the same active triple (idempotent)', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [{ machineId: 'm1', workingDir: '/a' }],
        target: { machineId: 'm1', workingDir: '/a' },
      })
    ).toBe(true);
  });

  test('refuses a second distinct active triple at the default cap', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [{ machineId: 'm1', workingDir: '/a' }],
        target: { machineId: 'm2', workingDir: '/b' },
      })
    ).toBe(false);
  });

  test('allows a second distinct triple when the cap is 2', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [{ machineId: 'm1', workingDir: '/a' }],
        target: { machineId: 'm2', workingDir: '/b' },
        cap: 2,
      })
    ).toBe(true);
  });

  test('refuses a third distinct triple when the cap is 2', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [
          { machineId: 'm1', workingDir: '/a' },
          { machineId: 'm2', workingDir: '/b' },
        ],
        target: { machineId: 'm3', workingDir: '/c' },
        cap: 2,
      })
    ).toBe(false);
  });

  test('allows an already-active triple at capacity', () => {
    expect(
      canRegisterWorkspace({
        activeWorkspaces: [
          { machineId: 'm1', workingDir: '/a' },
          { machineId: 'm2', workingDir: '/b' },
        ],
        target: { machineId: 'm1', workingDir: '/a' },
        cap: 2,
      })
    ).toBe(true);
  });

  test('the default cap is one', () => {
    expect(MAX_ACTIVE_WORKSPACES_PER_CHATROOM).toBe(1);
  });
});
