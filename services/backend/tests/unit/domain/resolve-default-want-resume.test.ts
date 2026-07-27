import { describe, expect, test } from 'vitest';

import { resolveDefaultWantResume } from '../../../src/domain/usecase/agent/resolve-default-want-resume';

describe('resolveDefaultWantResume', () => {
  test('duo builder returns false', () => {
    expect(resolveDefaultWantResume('duo', 'builder')).toBe(false);
  });

  test('duo planner returns false', () => {
    expect(resolveDefaultWantResume('duo', 'planner')).toBe(false);
  });

  test('solo returns false', () => {
    expect(resolveDefaultWantResume('solo', 'solo')).toBe(false);
  });

  test('is case-insensitive', () => {
    expect(resolveDefaultWantResume('DUO', 'Builder')).toBe(false);
    expect(resolveDefaultWantResume('Duo', 'PLANNER')).toBe(false);
  });
});
