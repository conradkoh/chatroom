import { describe, expect, test } from 'vitest';

import { resolveDefaultWantResume } from '../../../src/domain/usecase/agent/resolve-default-want-resume';

describe('resolveDefaultWantResume', () => {
  test('duo builder returns false', () => {
    expect(resolveDefaultWantResume('duo', 'builder')).toBe(false);
  });

  test('duo planner returns true', () => {
    expect(resolveDefaultWantResume('duo', 'planner')).toBe(true);
  });

  test('solo returns true', () => {
    expect(resolveDefaultWantResume('solo', 'solo')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(resolveDefaultWantResume('DUO', 'Builder')).toBe(false);
    expect(resolveDefaultWantResume('Duo', 'PLANNER')).toBe(true);
  });
});
