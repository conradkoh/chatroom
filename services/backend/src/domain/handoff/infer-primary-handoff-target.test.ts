import { describe, expect, test } from 'vitest';

import { inferPrimaryHandoffTarget } from './infer-primary-handoff-target';

describe('inferPrimaryHandoffTarget', () => {
  test('returns undefined for an empty target list', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: [],
      })
    ).toBeUndefined();
  });

  test('returns the first target when the sender is missing', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: undefined,
        role: 'builder',
        availableHandoffTargets: ['planner', 'user'],
      })
    ).toBe('planner');
  });

  test('returns the first target when sender and recipient roles match', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'BUILDER',
        role: 'builder',
        availableHandoffTargets: ['user', 'planner'],
      })
    ).toBe('user');
  });

  test('entry-point user task returns to user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('entry-point team-member task returns to user when available', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'builder',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('non-entry-point task returns to the sender', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: ['planner', 'user'],
        isEntryPoint: false,
      })
    ).toBe('planner');
  });

  test('ephemeral sender is handled like any other sender role', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'enhancer',
        role: 'builder',
        availableHandoffTargets: ['enhancer', 'user'],
        isEntryPoint: false,
      })
    ).toBe('enhancer');
  });
});
