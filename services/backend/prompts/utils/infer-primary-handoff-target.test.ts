import { describe, expect, test } from 'vitest';

import { inferPrimaryHandoffTarget } from './infer-primary-handoff-target';

describe('inferPrimaryHandoffTarget', () => {
  test('builder returns work to planner', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: ['planner'],
      })
    ).toBe('planner');
  });

  test('entry point planner receiving builder handback delivers to user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'builder',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('planner receiving user message targets user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'user',
        role: 'planner',
        availableHandoffTargets: ['builder', 'user'],
        isEntryPoint: true,
      })
    ).toBe('user');
  });

  test('non-entry-point does not redirect team sender to user', () => {
    expect(
      inferPrimaryHandoffTarget({
        senderRole: 'planner',
        role: 'builder',
        availableHandoffTargets: ['planner', 'user'],
        isEntryPoint: false,
      })
    ).toBe('planner');
  });
});
