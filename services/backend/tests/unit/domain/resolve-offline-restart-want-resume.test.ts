import { describe, expect, test } from 'vitest';

import { resolveOfflineRestartWantResume } from '../../../src/domain/usecase/agent/resolve-offline-restart-want-resume';

describe('resolveOfflineRestartWantResume', () => {
  test('duo builder → false', () => {
    expect(resolveOfflineRestartWantResume('duo', 'builder')).toBe(false);
  });
  test('duo planner → true', () => {
    expect(resolveOfflineRestartWantResume('duo', 'planner')).toBe(true);
  });
  test('duo enhancer → true', () => {
    expect(resolveOfflineRestartWantResume('duo', 'enhancer')).toBe(true);
  });
  test('duo reviewer → true', () => {
    expect(resolveOfflineRestartWantResume('duo', 'reviewer')).toBe(true);
  });
  test('solo builder → true', () => {
    expect(resolveOfflineRestartWantResume('solo', 'builder')).toBe(true);
  });
  test('case-insensitive', () => {
    expect(resolveOfflineRestartWantResume('DUO', 'Builder')).toBe(false);
    expect(resolveOfflineRestartWantResume('Duo', 'PLANNER')).toBe(true);
  });
});
